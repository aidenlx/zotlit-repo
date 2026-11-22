import { Data, Schema } from "effect";

export class ExcerptImageError extends Data.TaggedError("ExcerptImageError")<{
  readonly message: string;
}> {}

export class ExcerptCacheWriteError extends Schema.TaggedError<
  ExcerptCacheWriteError,
  { readonly brand: unique symbol }
>()("ExcerptCacheWriteError", { cause: Schema.Defect() }) {}
