// The tab service over a test's own services, for builders and the tab class.

import {
  Cause,
  Context,
  Effect,
  Exit,
  FileSystem,
  Layer,
  Queue,
  Scope,
} from "effect";
import { onTestFinished } from "vitest";

import { ExcerptDisplays } from "@zotlit/annotations/desktop/excerpt-image/display.ts";
import { CapabilityNotices } from "@zotlit/annotations/obsidian/annotation-repository/notices.ts";
import { AnnotationRepository } from "@zotlit/annotations/obsidian/annotation-repository/service.ts";
import { ExcerptImageService } from "@zotlit/annotations/obsidian/excerpt-image/service.ts";
import { CitationIndex } from "@zotlit/citations/obsidian/citation-index/service.ts";
import { PandocEngine } from "@zotlit/citations/obsidian/pandoc/service.ts";
import { NoteFeature } from "@zotlit/notes/desktop/note-feature/service.ts";
import { Profile } from "@zotlit/notes/obsidian/profile/service.ts";
import { Template } from "@zotlit/notes/obsidian/template/service.ts";
import { TemplateWorkbenchLauncher } from "@zotlit/notes/obsidian/template/workbench-launcher.ts";
import { testNotifier } from "@zotlit/obsidian-kit/__fixtures__/notifier.ts";
import { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import { FileManager } from "@zotlit/obsidian-kit/obsidian-file-manager.ts";
import { Vault } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import { Workspace } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import { PluginHost } from "@zotlit/obsidian-kit/plugin-host.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { LocalServer } from "@zotlit/plugin-services/core/local-server/service.ts";
import { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import { AttachmentImport } from "@zotlit/plugin-services/desktop/attachment-import/service.ts";
import { ChineseSegmenter } from "@zotlit/plugin-services/obsidian/chinese-segmenter/service.ts";
import { LanguagePack } from "@zotlit/plugin-services/obsidian/language-pack/service.ts";
import { LibraryScope } from "@zotlit/plugin-services/obsidian/library-scope/service.ts";
import { NoteIndex } from "@zotlit/plugin-services/obsidian/note-index/service.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import { ZoteroLocalApi } from "@zotlit/plugin-services/obsidian/zotero-local-api/service.ts";
import { Customize } from "@zotlit/template-workbench/desktop/local-bridge/customize.ts";
import { LocalBridge } from "@zotlit/template-workbench/desktop/local-bridge/service.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";
import type { ZoteroReadsApi } from "@zotlit/zotero-reads/client/service.ts";

import { Release } from "@/services/release/service.ts";

import { makeSettingTab } from "./effect-tab.ts";
import type { SettingTabShape } from "./effect-tab.ts";

/**
 * Every service the tab reads, with no member implemented: a test's own
 * services replace these, and a member no test gave fails that Effect with an
 * unimplemented defect.
 */
export const unimplementedTabServices = Layer.mergeAll(
  Layer.mock(PluginSettings)({}),
  Layer.mock(Profile)({}),
  Layer.mock(Template)({}),
  Layer.mock(ZoteroPref)({}),
  Layer.mock(ZoteroReads)({
    reads: stubService<ZoteroReadsApi>("ZoteroReads.reads", {}),
  }),
  Layer.mock(LibraryScope)({}),
  Layer.mock(LocalServer)({}),
  Layer.mock(Release)({ version: "0.0.0" }),
  Layer.mock(AnnotationRepository)({}),
  Layer.mock(ZoteroLocalApi)({}),
  Layer.mock(CapabilityNotices)({}),
  Layer.mock(CitationIndex)({}),
  Layer.mock(PandocEngine)({}),
  Layer.mock(ChineseSegmenter)({}),
  Layer.mock(AttachmentImport)({}),
  Layer.mock(LocalBridge)({}),
  Layer.mock(Customize)({}),
  Layer.mock(TemplateWorkbenchLauncher)({}),
  // Services with plain members: a read of a member no test gave throws.
  Layer.succeed(
    LanguagePack,
    stubService<LanguagePack["Service"]>("LanguagePack", {}),
  ),
  Layer.succeed(
    ExcerptImageService,
    stubService<ExcerptImageService["Service"]>("ExcerptImages", {}),
  ),
  Layer.succeed(
    ExcerptDisplays,
    stubService<ExcerptDisplays["Service"]>("ExcerptDisplays", {}),
  ),
  Layer.mock(NoteFeature)({}),
  Layer.mock(NoteIndex)({}),
  Layer.mock(Vault)({}),
  Layer.mock(Workspace)({}),
  Layer.mock(FileManager)({}),
  Layer.succeed(
    PluginHost,
    stubService<PluginHost["Service"]>("PluginHost", {}),
  ),
  Layer.succeed(
    FileSystem.FileSystem,
    stubService<FileSystem.FileSystem>("FileSystem", {}),
  ),
);

/**
 * A tab service whose Effects read `services`, with a recording Notifier
 * unless `services` brings one. Its fibers run in the current Scope, on the
 * current clock: under `it.effect`, TestClock drives a row's timers.
 */
export const scopedSettingTab = Effect.fnUntraced(function* (
  services: Context.Context<never> = Context.empty(),
  { update = () => {} }: { update?: () => void } = {},
) {
  const notifier = testNotifier();
  const tab: SettingTabShape = yield* makeSettingTab(update).pipe(
    Effect.provideContext(services),
    Effect.provideService(Notifier, notifier.service),
    Effect.provide(unimplementedTabServices),
  );
  return { tab, notices: notifier.notices };
});

/**
 * `scopedSettingTab` over the services `layer` builds, for a row whose actions
 * rebuild the tab or leave the settings window. `rebuilt` takes one element
 * per definition rebuild an action asks for; the settings window closes
 * through `close`.
 */
export const rebuildingSettingTab = Effect.fnUntraced(function* (
  layer: Layer.Layer<never>,
  { close = () => {} }: { close?: () => void } = {},
) {
  const services = yield* Layer.build(
    Layer.merge(
      layer,
      Layer.succeed(
        PluginHost,
        stubService<PluginHost["Service"]>("PluginHost", {
          closeSettings: Effect.sync(close),
        }),
      ),
    ),
  );
  const rebuilt = yield* Queue.unbounded<void>();
  const { tab, notices } = yield* scopedSettingTab(services, {
    update: () => Queue.offerUnsafe(rebuilt, undefined),
  });
  return { tab, notices, rebuilt };
});

/** A handler Effect that `run` received: how it ended, and its label. */
export interface RecordedRun {
  readonly exit: Exit.Exit<unknown, unknown>;
  readonly label: string | undefined;
}

/**
 * `tab` with a `run` that also records each handler's Exit and label, for a
 * row test that tells a failed action from a done one. The label's notice is
 * `run`'s own behavior, which effect-tab.test.ts covers.
 */
export function recordingRuns(tab: SettingTabShape) {
  const runs: RecordedRun[] = [];
  const run: SettingTabShape["run"] = (effect, label) =>
    tab.run(
      effect.pipe(
        Effect.onExit((exit) => Effect.sync(() => runs.push({ exit, label }))),
      ),
      label,
    );
  return { tab: { ...tab, run }, runs: runs as readonly RecordedRun[] };
}

/** The error a recorded run failed with, or `undefined` when it succeeded. */
export const failureOf = ({ exit }: RecordedRun) =>
  Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;

/** `scopedSettingTab` for a plain test: its fibers end when the test finishes. */
export function testSettingTab(...args: Parameters<typeof scopedSettingTab>) {
  const scope = Scope.makeUnsafe();
  onTestFinished(() => Effect.runPromise(Scope.close(scope, Exit.void)));
  return Effect.runSync(
    scopedSettingTab(...args).pipe(Effect.provideService(Scope.Scope, scope)),
  );
}

/**
 * The Profile, Template and Vault reads of the Profile and Template rows:
 * a loaded registry with no Profile, no excluded document, no partial and no
 * saved Default document, unless a test overrides a member.
 */
export function profileRowServices(
  overrides: {
    profile?: Partial<Profile["Service"]>;
    template?: Partial<Template["Service"]>;
    vault?: Partial<Vault["Service"]>;
  } = {},
) {
  return Context.make(
    Profile,
    stubService<Profile["Service"]>("Profile", {
      loaded: Effect.succeed(true),
      profiles: Effect.succeed([]),
      diagnostics: Effect.succeed([]),
      defaultDocumentPath: Effect.succeed(
        "templates/zotlit-profile.default.md",
      ),
      ...overrides.profile,
    }),
  ).pipe(
    Context.add(
      Template,
      stubService<Template["Service"]>("Template", {
        loaded: Effect.succeed(true),
        javascriptTemplatesEnabled: Effect.succeed(false),
        getPartialDocuments: Effect.succeed([]),
        getReservedPartialFiles: Effect.succeed([]),
        getUnrecognizedFiles: Effect.succeed([]),
        ...overrides.template,
      }),
    ),
    Context.add(
      Vault,
      stubService<Vault["Service"]>("Vault", {
        getFileByPath: () => Effect.succeed(null),
        ...overrides.vault,
      }),
    ),
  );
}
