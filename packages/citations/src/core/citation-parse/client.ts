import type { NoteScanRecord } from "#core/citation-index/scan-note.ts";
import type { Effect } from "effect";
import { Schema } from "effect";

export class ParseWorkerDied extends Schema.TaggedError<
  ParseWorkerDied,
  { readonly brand: unique symbol }
>()("ParseWorkerDied", {
  message: Schema.String,
}) {}

export class ParseFailed extends Schema.TaggedError<
  ParseFailed,
  { readonly brand: unique symbol }
>()("ParseFailed", {
  message: Schema.String,
}) {}

export interface ParseRequest {
  path: string;
  generation: number;
  text: string;
  indexOnly?: true;
}

export interface ParseReply {
  path: string;
  generation: number;
  record: NoteScanRecord;
}

export interface ParseClient {
  parse(
    request: ParseRequest,
  ): Effect.Effect<ParseReply, ParseWorkerDied | ParseFailed>;
}

export const decodeParseReply = (json: string): ParseReply =>
  JSON.parse(json) as ParseReply;
