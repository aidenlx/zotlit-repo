import { Schema } from "effect";

export class DbUnavailable extends Schema.TaggedError<
  DbUnavailable,
  { readonly brand: unique symbol }
>()("DbUnavailable", { message: Schema.String }) {}
