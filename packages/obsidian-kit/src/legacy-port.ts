import { Effect, Schema } from "effect";

import { AbortError } from "@zotlit/plugin-kernel/abort-error.ts";

import { formatErrorMessage } from "./toast.ts";

export class LegacyPortError extends Schema.TaggedError<
  LegacyPortError,
  { readonly brand: unique symbol }
>()("LegacyPortError", {
  step: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return formatErrorMessage(this.cause);
  }
}

export const portCall = <const S extends string, A>(
  step: S,
  call: (signal: AbortSignal) => Promise<A>,
): Effect.Effect<A, LegacyPortError> =>
  Effect.tryPromise({
    try: call,
    catch: (cause) => new LegacyPortError({ step, cause }),
  }).pipe(
    Effect.catchIf(
      (error) => AbortError.test(error.cause),
      () => Effect.interrupt,
    ),
  );
