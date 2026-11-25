import { effectImageResolver } from "@zotlit/annotations/__fixtures__/excerpt-image/service.ts";
import type { ExcerptImageFixture } from "@zotlit/annotations/__fixtures__/excerpt-image/service.ts";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { Context, Effect, Layer } from "effect";
import type { ManagedRuntime } from "effect";

import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { effectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { buildRuntime } from "@zotlit/plugin-kernel/effect-layer.ts";
import { layerVaultDiskOver } from "@zotlit/plugin-shell/desktop/__fixtures__/vault-disk.ts";
import { layerFileManagerFrom } from "@zotlit/obsidian-kit/obsidian-file-manager.ts";
import type {
  FileManager,
  FileManagerSource,
} from "@zotlit/obsidian-kit/obsidian-file-manager.ts";
import {
  layerMetadataCacheFrom,
  MetadataCache,
} from "@zotlit/obsidian-kit/obsidian-metadata-cache.ts";
import type { MetadataCacheSource } from "@zotlit/obsidian-kit/obsidian-metadata-cache.ts";
import { layerVaultFrom, Vault } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import type { VaultSource } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import { layerWorkspaceFrom } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import type { Workspace, WorkspaceSource } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import { AttachmentImport } from "@zotlit/plugin-services/desktop/attachment-import/service.ts";
import { ExcerptImageService } from "@zotlit/annotations/obsidian/excerpt-image/service.ts";
import {
  ExcerptPreparation,
  layerExcerptPreparation,
} from "@zotlit/annotations/desktop/excerpt-image/prepare.ts";
import type {
  NoteExcerptOptions,
  PreparedExcerpts,
} from "@zotlit/annotations/desktop/excerpt-image/prepare.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import { snapshotAt } from "@zotlit/plugin-services/desktop/attachment-import/__fixtures__.ts";
import { Template } from "#obsidian/template/service.ts";
import type { TemplateOperations } from "#obsidian/template/service.ts";
import { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";

import type { NoteCitations } from "#desktop/note-feature/citations-handle.ts";
import type { ItemMatchQuery } from "#core/profile-selection/item-matches.ts";
import { bindNoteFeature } from "#desktop/note-feature/handle.ts";
import type { NoteCreation } from "#desktop/note-feature/creation-handle.ts";
import type { NoteFeatureHandle } from "#desktop/note-feature/operations.ts";
import { layerNoteFeature, NoteFeature } from "#desktop/note-feature/service.ts";
import type { NoteFeatureServices } from "#desktop/note-feature/service.ts";

import { planningContext } from "./planning-context.ts";
import type { PlanningSources } from "./planning-context.ts";

export interface NoteFeatureApp {
  vault: VaultSource;
  fileManager: FileManagerSource;
  metadataCache: MetadataCacheSource;
  workspace: WorkspaceSource;
}

export interface NoteFeatureSources extends Omit<
  PlanningSources,
  "template" | "app"
> {
  template: PlanningSources["template"] &
    Pick<TemplateOperations, "render" | "renderManagedContent">;
  app: NoteFeatureApp;
  settings: Pick<PluginSettings["Service"], "current" | "update">;
  zoteroPref: { dataDir: string; baseAttachmentPath: string | null };
  attachmentImport: Pick<AttachmentImport["Service"], "prepare">;
  excerptImages?: (options: NoteExcerptOptions) => PreparedExcerpts;
  excerptResolver?: Pick<ExcerptImageFixture, "operation" | "resolve">;
}

const noExcerpts = (): PreparedExcerpts => ({
  annotationImageLink: () => null,
  prepare: Effect.void,
  summary: () => ({ zotero: 0, unchecked: 0, unavailable: 0 }),
});

function layerExcerptPreparationOver(
  sources: NoteFeatureSources,
  host: Layer.Layer<
    | Vault
    | MetadataCache
    | Workspace
    | FileManager
  >,
  pref: Context.Context<ZoteroPref>,
): Layer.Layer<ExcerptPreparation> {
  const real = layerExcerptPreparation.pipe(
    Layer.provide(
      Layer.mergeAll(
        host,
        layerVaultDiskOver(sources.app.vault),
        NodeFileSystem.layer,
        Layer.succeedContext(pref),
        Layer.succeed(
          ExcerptImageService,
          stubService<ExcerptImageService["Service"]>("ExcerptImages", {
            ...effectImageResolver({
              resolve: (request, signal) => sources.excerptResolver!.resolve(request, signal),
              operation: (options) => sources.excerptResolver!.operation(options),
            }),
          }),
        ),
      ),
    ),
  );
  return Layer.effect(
    ExcerptPreparation,
    Effect.gen(function* () {
      const preparation = yield* ExcerptPreparation;
      const given = <K extends "excerptImages" | "excerptResolver">(key: K) =>
        key in sources ? sources[key] : undefined;
      return ExcerptPreparation.of({
        forNote: (options) => {
          const fake = given("excerptImages");
          if (fake) return Effect.sync(() => fake(options));
          return given("excerptResolver")
            ? preparation.forNote(options)
            : Effect.sync(noExcerpts);
        },
        forCard: (options) => preparation.forCard(options),
      });
    }),
  ).pipe(Layer.provide(real));
}

export function noteFeatureServices(
  sources: NoteFeatureSources,
  itemMatches?: ItemMatchQuery["Service"],
): Layer.Layer<NoteFeatureServices> {
  const { app } = sources;
  const vault = layerVaultFrom(app.vault);
  const host = Layer.mergeAll(
    vault,
    layerFileManagerFrom(app.fileManager).pipe(Layer.provide(vault)),
    layerMetadataCacheFrom(app.metadataCache),
    layerWorkspaceFrom(app.workspace),
  );
  const planning = planningContext(sources, itemMatches).pipe(
    Context.omit(Vault, MetadataCache, Template),
  );
  const plain = Context.make(
    Template,
    stubService<Template["Service"]>("Template", {
      render: (name, data) =>
        Effect.sync(() => sources.template.render(name, data)),
      renderManagedContent: (data) =>
        Effect.sync(() => sources.template.renderManagedContent(data)),
      renderFilename: (data) =>
        Effect.sync(() => sources.template.renderFilename(data)),
      getLiteratureNoteTemplate: (reference) =>
        Effect.sync(() =>
          sources.template.getLiteratureNoteTemplate(reference),
        ),
      frontmatterFields: Effect.sync(() => sources.template.frontmatterFields),
    }),
  ).pipe(
    Context.add(
      PluginSettings,
      stubService<PluginSettings["Service"]>("PluginSettings", {
        current: Effect.suspend(() => sources.settings.current),
        update: (patch) => Effect.suspend(() => sources.settings.update(patch)),
      }),
    ),
    Context.add(
      ZoteroPref,
      stubService<ZoteroPref["Service"]>("ZoteroPref", {
        current: Effect.sync(() => snapshotAt(sources.zoteroPref)),
      }),
    ),
  );
  return Layer.mergeAll(
    host,
    Layer.mock(AttachmentImport, {
      prepare: (notePath, options) =>
        Effect.suspend(() =>
          sources.attachmentImport.prepare(notePath, options),
        ),
    }),
    Layer.succeedContext(Context.merge(planning, plain)),
    layerExcerptPreparationOver(sources, host, plain.pipe(Context.pick(ZoteroPref))),
  );
}

export function noteFeatureHandle(
  sources: NoteFeatureSources,
  stack: AsyncDisposableStack,
  options: {
    citations?: NoteCitations;
    itemMatches?: ItemMatchQuery["Service"];
  } = {},
 ): {
  handle: NoteFeatureHandle;
  runtime: ManagedRuntime.ManagedRuntime<NoteFeature, never>;
  service: NoteFeature["Service"];
} {
  const runtime = buildRuntime(
    layerNoteFeature.pipe(
      Layer.provideMerge(noteFeatureServices(sources, options.itemMatches)),
    ),
    stack,
  );
  const service = runtime.runSync(NoteFeature);
  const handle = bindNoteFeature(
    effectBridge(runtime),
    service,
    stubService<NoteCitations & NoteCreation>("NoteFeatureEdges", {
      ...options.citations,
    }),
  );
  return { handle, runtime, service };
}
