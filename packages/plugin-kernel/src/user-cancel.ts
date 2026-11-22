import { Schema } from "effect";

import { AbortError } from "#abort-error.ts";

export class UserCancelled extends Schema.TaggedError<
  UserCancelled,
  { readonly brand: unique symbol }
>()("UserCancelled", {}) {}

export function isUserStop(error: unknown): boolean {
  return AbortError.test(error) || error instanceof UserCancelled;
}
