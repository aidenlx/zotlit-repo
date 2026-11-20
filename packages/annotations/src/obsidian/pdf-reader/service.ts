import { Context, Effect, Layer, Schema } from "effect";
import type { PaneType, TFile } from "obsidian";

import { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import { ObsidianApp } from "@zotlit/obsidian-kit/obsidian-app.ts";
import { DeviceStorage } from "@zotlit/obsidian-kit/obsidian-device-storage.ts";
import { Workspace } from "@zotlit/obsidian-kit/obsidian-workspace.ts";

import { fallbackNotice } from "#obsidian/reader-connection/notice.ts";
import { ReaderConnection } from "#obsidian/reader-connection/service.ts";
import {
  readerInstalled,
  readerStatus,
} from "#obsidian/reader-connection/status.ts";

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
  ReaderConnection | Workspace | ObsidianApp | DeviceStorage | Notifier
> = Layer.effect(
  ZotlitPdfReader,
  Effect.gen(function* () {
    const connection = yield* ReaderConnection;
    const workspace = yield* Workspace;
    const app = yield* ObsidianApp;
    const storage = yield* DeviceStorage;
    const notifier = yield* Notifier;
    return ZotlitPdfReader.of({
      open: Effect.fn("ZotlitPdfReader.open")(
        function* (
          file,
          subpath,
          pane,
        ): Effect.fn.Return<ZotlitPdfOpenOutcome, ReaderOpenFailed> {
          const state = yield* connection.current;
          if (state.status === "connected") {
            return yield* Effect.tryPromise({
              try: () => state.api.open(file, { subpath, pane }),
              catch: (cause) => new ReaderOpenFailed({ cause }),
            });
          }
          const leaf = yield* workspace.getLeaf(pane);
          yield* Effect.tryPromise({
            try: () =>
              leaf.openFile(
                file,
                subpath ? { eState: { subpath } } : undefined,
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
