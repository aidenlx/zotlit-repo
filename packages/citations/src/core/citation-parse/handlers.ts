import { Effect } from "effect";

import { CitationParseRpc, ParseError } from "./rpc.ts";

import { scanNote } from "#core/citation-index/scan-note.ts";

export const layerParseHandlers = CitationParseRpc.toLayer({
  Parse: ({ path, generation, text }) =>
    Effect.try({
      try: () => JSON.stringify({ path, generation, record: scanNote(text) }),
      catch: (error) => new ParseError({ message: String(error) }),
    }),
});
