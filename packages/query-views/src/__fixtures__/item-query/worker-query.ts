import type { CliData } from "obsidian";

import { Effect, Schema } from "effect";

import { decodeQuery } from "#desktop/item-query/decode.ts";
import { DecodedQuery } from "@zotlit/zotero-reads/contract/query-codec.ts";

export function workerQuery(params: CliData = {}): DecodedQuery {
  const query = Effect.runSync(decodeQuery(params));
  return Schema.decodeSync(DecodedQuery)(
    Schema.encodeSync(DecodedQuery)(query),
  );
}
