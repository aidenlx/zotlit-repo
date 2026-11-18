import { Effect } from "effect";

import { CitationParseRpc, ParseError } from "./rpc.ts";

import { scanNote } from "#core/citation-index/scan-note.ts";

export const layerParseHandlers = CitationParseRpc.toLayer({
  // CitationParse.parse traces the service call; keep the scanner's hot path small.
  Parse: ({ path, generation, text }) =>
    Effect.try({
      try: () => JSON.stringify({ path, generation, record: scanNote(text) }),
      catch: (error) => new ParseError({ message: String(error) }),
    }),
});
