import { Effect } from "effect";
import type { Stream } from "effect";
import { requestUrl } from "obsidian";

import { requireElectronRemote } from "@zotlit/obsidian-desktop/require.ts";
import { ObsidianApp } from "@zotlit/obsidian-kit/obsidian-app.ts";
import { Workspace } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import type { WorkspaceEvent } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import type {
  LibrarySourcePorts,
  WebStart,
} from "@zotlit/plugin-services/obsidian/library-source/service.ts";
import { removeOriginDirectory } from "@zotlit/plugin-services/obsidian/library-source/stored-replica.ts";
import { ResourcePackPlatform } from "@zotlit/plugin-services/obsidian/managed-binary/pack-platform.ts";

import { readServerSchemaVersion } from "./schema-version.ts";
import { ZoteroReadsWebWorker } from "./web-worker-client.ts";

const WEB_API_URL_KEY = "zotlit-zotero-web-api-url";

const systemLanguage = Effect.sync((): string | null => {
  const fallback = navigator.languages[0] ?? null;
  try {
    return (
      requireElectronRemote().app.getPreferredSystemLanguages()[0] ?? fallback
    );
  } catch {
    return fallback;
  }
});

export const librarySourcePorts = Effect.fn("LibrarySource.ports")(function* (
  focusOf: (
    changes: Stream.Stream<WorkspaceEvent>,
    open: Effect.Effect<readonly Window[]>,
  ) => Stream.Stream<boolean>,
) {
  const app = yield* ObsidianApp;
  const workspace = yield* Workspace;
  const worker = yield* ZoteroReadsWebWorker;
  const pack = yield* ResourcePackPlatform;
  return {
    startWeb: Effect.fn("LibrarySource.startWeb")(function* (config) {
      const read = yield* worker.readWasm(pack);
      if (read.kind !== "ready") return read;
      return yield* worker.start(read.wasm, { config }).pipe(
        Effect.map((client): WebStart => ({ kind: "ready", client })),
        Effect.catchTag("WebWorkerCodeUnreadable", (error) =>
          Effect.as(
            Effect.logError("The online library Worker did not load", error),
            { kind: "code-unreadable" } as const,
          ),
        ),
      );
    }),
    poolDirectory: Effect.map(
      Effect.promise(() => import("@zotlit/zotero-reads/client/web-worker.ts")),
      ({ replicaDirectory }) => replicaDirectory(app.appId),
    ),
    systemLanguage,
    focused: focusOf(workspace.changes, workspace.windows),
    secrets: app.secretStorage,
    ...(__DEV__ && {
      webApiUrlOverride: Effect.sync(() =>
        app.loadLocalStorage(WEB_API_URL_KEY),
      ),
    }),
    serverSchemaVersion: (baseUrl) =>
      readServerSchemaVersion(requestUrl, baseUrl),
    removeStoredReplica: (poolDirectory) =>
      removeOriginDirectory(poolDirectory),
    reload: Effect.sync(() => {
      app.commands.executeCommandById("app:reload");
    }),
  } satisfies LibrarySourcePorts;
});
