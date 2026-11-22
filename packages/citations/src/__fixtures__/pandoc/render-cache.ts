import { testPluginHost } from "@zotlit/obsidian-kit/__fixtures__/plugin-host.ts";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { Context, Effect, Layer, Stream } from "effect";

import { testNotifier } from "@zotlit/obsidian-kit/__fixtures__/notifier.ts";
import { MemoryDeviceStorage } from "@zotlit/obsidian-kit/__fixtures__/obsidian-device-storage.ts";
import { layerDeviceStorageFrom } from "@zotlit/obsidian-kit/obsidian-device-storage.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { AbortError } from "@zotlit/plugin-kernel/abort-error.ts";
import { effectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { buildRuntime } from "@zotlit/plugin-kernel/effect-layer.ts";
import {
  QueryClients,
  layerQueryClients,
} from "@zotlit/plugin-services/core/query-client/service.ts";
import { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import type { BinaryHandle } from "@zotlit/plugin-services/obsidian/managed-binary/handle.ts";
import type { PackBinaryApi } from "@zotlit/plugin-services/obsidian/managed-binary/pack-binary.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";

import type { CitationEngine } from "#obsidian/pandoc/engine.ts";
import { BibliographyRender, BibliographyRenderError } from "#obsidian/pandoc/render-cache.ts";
import { layerBibliographyRender } from "#desktop/pandoc/render-cache-layer.ts";
import { PandocEngine } from "#obsidian/pandoc/service.ts";
import { ProfileStyles } from "#obsidian/pandoc/profile-styles.ts";

export function renderFailure(
  error: unknown,
): BibliographyRenderError | DOMException {
  if (error instanceof BibliographyRenderError || AbortError.test(error))
    return error;
  return new BibliographyRenderError({
    message: Error.isError(error) ? error.message : String(error),
    cause: error,
  });
}

export interface BibliographyRenderFixtureOptions {
  profile: Pick<ProfileStyles["Service"], "changes"> &
    Partial<Pick<ProfileStyles["Service"], "vaultStyleId">>;
  db: Pick<ZoteroReads["Service"], "events">;
  pandocEngine: Pick<BinaryHandle<PackBinaryApi<CitationEngine>>, "binary">;
  zoteroPref: {
    readonly dataDir: string;
    readonly moves: Stream.Stream<void>;
  };
  settings: Pick<PluginSettings["Service"], "current" | "changes">;
  queryClient?: Pick<
    QueryClients["Service"],
    "changes" | "ask" | "readFresh" | "peek" | "invalidate" | "watch"
  >;
}

export async function bibliographyRenderFixture(
  options: BibliographyRenderFixtureOptions,
  context: Context.Context<never> = Context.empty(),
) {
  await using stack = new AsyncDisposableStack();

  const profileState = { loaded: true } as const;
  const prefs = new Map();
  const prefSnapshot = () => ({
    prefs,
    dataDir: options.zoteroPref.dataDir,
    dataDirOverride: null,
    state: "ready" as const,
    resolvedProfileDir: null,
    profileDirOverride: null,
    databasePath: "",
    sourceId: null,
    baseAttachmentPath: null,
    httpPort: null,
  });
  const query = options.queryClient;
  const queryLayer = query
    ? Layer.succeed(
        QueryClients,
        stubService<QueryClients["Service"]>("QueryClients", {
          ...query,
        }),
      )
    : layerQueryClients;
  const notifier = testNotifier();
  const layer = layerBibliographyRender.pipe(
    Layer.provide(
      Layer.mergeAll(
        queryLayer,
        notifier.layer,
        layerDeviceStorageFrom(new MemoryDeviceStorage()),
        NodeFileSystem.layer,
        Layer.succeed(
          ProfileStyles,
          stubService<ProfileStyles["Service"]>("ProfileStyles", {
            state: Effect.succeed(profileState),
            changes: options.profile.changes,
            vaultStyleId: options.profile.vaultStyleId ?? (() => null),
          }),
        ),
        Layer.succeed(
          ZoteroReads,
          stubService<ZoteroReads["Service"]>("ZoteroReads", {
            events: options.db.events,
          }),
        ),
        Layer.succeed(
          PandocEngine,
          stubService<PandocEngine["Service"]>("PandocEngine", {
            current: options.pandocEngine.binary.current,
            getEngine: options.pandocEngine.binary.getEngine,
            changes: options.pandocEngine.binary.changes,
          }),
        ),
        Layer.succeed(
          ZoteroPref,
          stubService<ZoteroPref["Service"]>("ZoteroPref", {
            current: Effect.sync(prefSnapshot),
            changes: options.zoteroPref.moves.pipe(
              Stream.map(() => ({ ...prefSnapshot(), prefs: new Map() })),
            ),
          }),
        ),
        Layer.succeed(
          PluginSettings,
          stubService<PluginSettings["Service"]>("PluginSettings", {
            current: options.settings.current,
            changes: options.settings.changes,
          }),
        ),
        testPluginHost({ manifest: { id: "zotlit" } }).layer,
      ),
    ),
  );
  const runtime = buildRuntime(
    layer.pipe(Layer.provideMerge(Layer.succeedContext(context))),
    stack,
  );
  await runtime.context();
  const cache = runtime.runSync(BibliographyRender);
  const owned = stack.move();
  return Object.assign(cache, {
    runtime,
    bridge: effectBridge(runtime),
    notices: notifier.notices,
    [Symbol.asyncDispose]: () => owned.disposeAsync(),
  });
}
