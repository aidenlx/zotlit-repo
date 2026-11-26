import { Context, Effect, Layer, Schema, Scope } from "effect";
import { WorkspaceLeaf } from "obsidian";
import type { PaneType, TFile } from "obsidian";

import { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import { ObsidianApp } from "@zotlit/obsidian-kit/obsidian-app.ts";
import { DeviceStorage } from "@zotlit/obsidian-kit/obsidian-device-storage.ts";
import { Vault } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import { Workspace } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import { scopedBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { AttachmentResolver } from "@zotlit/plugin-services/obsidian/attachment-resolver/service.ts";
import type { AttachmentResolution } from "@zotlit/plugin-services/obsidian/attachment-resolver/service.ts";

import {
  OBSIDIAN_PDF_VIEW_TYPE,
  registerViewerRouting,
  viewerOf,
} from "./viewer.ts";
import type { ViewStateHost } from "./viewer.ts";

import { fallbackNotice } from "#obsidian/reader-connection/notice.ts";
import {
  ReaderConnection,
  whileConnected,
} from "#obsidian/reader-connection/service.ts";
import {
  readerInstalled,
  readerStatus,
} from "#obsidian/reader-connection/status.ts";

const SETTLE_WAIT = "2 seconds";

export type ZotlitPdfOpenOutcome = "opened" | "file-missing";

export class ReaderOpenFailed extends Schema.TaggedError<
  ReaderOpenFailed,
  { readonly brand: unique symbol }
>()("ReaderOpenFailed", { cause: Schema.Defect() }) {}

export class ZotlitPdfReader extends Context.Service<
  ZotlitPdfReader,
  {
    open(
      file: TFile,
      subpath: string,
      pane: PaneType | boolean,
    ): Effect.Effect<ZotlitPdfOpenOutcome, ReaderOpenFailed>;
  }
>()("zotlit/pdf-reader/ZotlitPdfReader") {}

export const layerZotlitPdfReader: Layer.Layer<
  ZotlitPdfReader,
  never,
  | ReaderConnection
  | Workspace
  | ObsidianApp
  | DeviceStorage
  | Notifier
  | AttachmentResolver
  | Vault
> = Layer.effect(
  ZotlitPdfReader,
  Effect.gen(function* () {
    const connection = yield* ReaderConnection;
    const workspace = yield* Workspace;
    const app = yield* ObsidianApp;
    const storage = yield* DeviceStorage;
    const notifier = yield* Notifier;
    const attachments = yield* AttachmentResolver;
    const vault = yield* Vault;
    const bridge = yield* scopedBridge;
    const connectionScopes = yield* Scope.fork(yield* Effect.scope);
    const attachmentOf = (
      path: string,
    ): AttachmentResolution | Promise<AttachmentResolution> => {
      const file = bridge.runSync(vault.getFileByPath(path));
      if (!file) return { kind: "unresolved" };
      const now = bridge.runSync(attachments.resolveFile(file));
      return now.kind === "pending"
        ? bridge.runPromise(
            attachments.resolveFile(file, { wait: SETTLE_WAIT }),
          )
        : now;
    };
    yield* whileConnected(connection, connectionScopes, (api) =>
      Effect.andThen(
        attachments.warm,
        Effect.acquireDisposable(
          Effect.sync(() =>
            registerViewerRouting(
              WorkspaceLeaf.prototype as unknown as ViewStateHost,
              { viewType: api.viewType, attachmentOf },
            ),
          ),
        ),
      ),
    );
    return ZotlitPdfReader.of({
      open: Effect.fn("ZotlitPdfReader.open")(
        function* (
          file,
          subpath,
          pane,
        ): Effect.fn.Return<ZotlitPdfOpenOutcome, ReaderOpenFailed> {
          const state = yield* connection.current;
          const viewer = viewerOf(state.status === "connected", {
            kind: "attachment",
          });
          if (viewer === "reader" && state.status === "connected") {
            return yield* Effect.tryPromise({
              try: () => state.api.open(file, { subpath, pane }),
              catch: (cause) => new ReaderOpenFailed({ cause }),
            });
          }
          const leaf = yield* workspace.getLeaf(pane);
          const active = (yield* workspace.activeLeaf) === leaf;
          yield* Effect.tryPromise({
            try: () =>
              leaf.setViewState(
                {
                  type: OBSIDIAN_PDF_VIEW_TYPE,
                  state: { file: file.path },
                  active,
                },
                subpath ? { subpath } : undefined,
              ),
            catch: (cause) => new ReaderOpenFailed({ cause }),
          });
          const status = readerStatus(state, readerInstalled(app));
          if (status !== "connected")
            yield* fallbackNotice(status).pipe(
              Effect.provideService(DeviceStorage, storage),
              Effect.provideService(Notifier, notifier),
              Effect.tapError((error) =>
                Effect.logDebug(
                  "The fallback notice could not read or save its device storage",
                  error,
                ),
              ),
              Effect.ignore,
            );
          return "opened";
        },
      ),
    });
  }),
);
