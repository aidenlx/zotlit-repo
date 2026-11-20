import { Context, Effect, Layer, Schema } from "effect";
import type { PaneType, TFile } from "obsidian";

import type { PdfReaderRegistration } from "@zotlit/pdf-reader/obsidian";

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

export const layerZotlitPdfReader: Layer.Layer<ZotlitPdfReader> = Layer.sync(
  ZotlitPdfReader,
  () => {
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
          const { registration } = port;
          if (!registration) {
            return yield* new ReaderUnavailable({
              message: "The ZotLit PDF reader is not registered",
            });
          }
          const view = yield* Effect.tryPromise({
            try: () => registration.open(file, { subpath, pane }),
            catch: (cause) => new ReaderOpenFailed({ cause }),
          });
          return view === null ? "file-missing" : "opened";
        },
      ),
    });
  },
);
