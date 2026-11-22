import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";

export class ParseError extends Schema.TaggedError<
  ParseError,
  { readonly brand: unique symbol }
>()("ParseError", {
  message: Schema.String,
}) {}

export const CitationParseRpc = RpcGroup.make(
  Rpc.make("Parse", {
    payload: {
      path: Schema.String,
      generation: Schema.Int,
      text: Schema.String,
    },
    success: Schema.String,
    error: ParseError,
  }),
);
