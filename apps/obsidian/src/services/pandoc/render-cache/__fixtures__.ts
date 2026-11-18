import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
/** The real bibliography layer over the dependency ports used by consumer fixtures. */
import { Context, Effect, Layer, Stream } from "effect";

import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { AbortError } from "@zotlit/plugin-kernel/abort-error.ts";
import { effectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { buildRuntime } from "@zotlit/plugin-kernel/effect-layer.ts";

import type { ManagedBinaryHandle } from "@/services/managed-binary/handle.ts";
import type { CitationEngine } from "@/services/pandoc/engine.ts";
import {
  BibliographyRender,
  BibliographyRenderError,
  layerBibliographyRender,
} from "@/services/pandoc/render-cache.ts";
import { PandocEngine } from "@/services/pandoc/service.ts";
import { Profile } from "@/services/profile/service.ts";
import {
  QueryClients,
  layerQueryClients,
} from "@/services/query-client/service.ts";
import { PluginSettings } from "@/services/settings/service.ts";
import { ZoteroPref } from "@/services/zotero-pref/service.ts";
import { ZoteroReads } from "@/services/zotero-reads/service.ts";

/**
 * A render read's rejection as the real member fails: an abort and a
 * {@link BibliographyRenderError} keep their identity, and any other rejection
 * is the engine's, wrapped with its own message.
 */
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
  profile: Pick<Profile["Service"], "changes">;
  db: Pick<ZoteroReads["Service"], "events">;
  pandocEngine: Pick<ManagedBinaryHandle<CitationEngine>, "binary">;
  zoteroPref: {
    readonly dataDir: string;
    /** Each move of the profile or data folder Zotero reads from. */
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

  const profileState = {
    loaded: true,
    profiles: [],
    diagnostics: [],
    defaultDocumentPath: "",
    templateStatus: { state: "loaded", compileErrors: new Map() },
  } as const;
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
  const layer = layerBibliographyRender.pipe(
    Layer.provide(
      Layer.mergeAll(
        queryLayer,
        NodeFileSystem.layer,
        Layer.succeed(
          Profile,
          stubService<Profile["Service"]>("Profile", {
            state: Effect.succeed(profileState),
            changes: options.profile.changes,
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
            getStatus: options.pandocEngine.binary.getStatus,
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
    [Symbol.asyncDispose]: () => owned.disposeAsync(),
  });
}
