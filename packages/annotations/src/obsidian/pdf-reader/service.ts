import { Context, Effect, Layer, Schema } from "effect";
import type { PaneType, TFile } from "obsidian";

import type { PdfReaderRegistration } from "@zotlit/pdf-reader/obsidian";

import { ReaderConnection } from "#obsidian/reader-connection/service.ts";

export interface ZotlitPdfReaderPort {
  registration: PdfReaderRegistration | null;
}

export type ZotlitPdfOpenOutcome = "opened" | "file-missing";

export class ReaderUnavailable extends Schema.TaggedError<
  ReaderUnavailable,
  { readonly brand: unique symbol }
>()("ReaderUnavailable", { message: Schema.String }) {}

export class ReaderOpenFailed extends Schema.TaggedError<
  ReaderOpenFailed,
  { readonly brand: unique symbol }
>()("ReaderOpenFailed", { cause: Schema.Defect() }) {}

export class ZotlitPdfReader extends Context.Service<
  ZotlitPdfReader,
  {
    readonly port: ZotlitPdfReaderPort;
    open(
      file: TFile,
      subpath: string,
      pane: PaneType | boolean,
    ): Effect.Effect<
      ZotlitPdfOpenOutcome,
      ReaderUnavailable | ReaderOpenFailed
    >;
  }
>()("zotlit/pdf-reader/ZotlitPdfReader") {}

export const layerZotlitPdfReader: Layer.Layer<
  ZotlitPdfReader,
  never,
  ReaderConnection
> = Layer.effect(
  ZotlitPdfReader,
  Effect.gen(function* () {
    const connection = yield* ReaderConnection;
    const port: ZotlitPdfReaderPort = { registration: null };
    return ZotlitPdfReader.of({
      port,
      open: Effect.fn("ZotlitPdfReader.open")(
        function* (
          file,
          subpath,
          pane,
        ): Effect.fn.Return<
          ZotlitPdfOpenOutcome,
          ReaderUnavailable | ReaderOpenFailed
        > {
          const state = yield* connection.current;
          if (state.status !== "connected") {
            return yield* new ReaderUnavailable({
              message: "The ZotLit PDF reader is not registered",
            });
          }
          return yield* Effect.tryPromise({
            try: () => state.api.open(file, { subpath, pane }),
            catch: (cause) => new ReaderOpenFailed({ cause }),
          });
        },
      ),
    });
  }),
);
