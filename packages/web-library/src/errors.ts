import { Schema } from "effect";

export class WebApiKeyInvalid extends Schema.TaggedError<
  WebApiKeyInvalid,
  { readonly brand: unique symbol }
>()("WebApiKeyInvalid", { message: Schema.String }) {}

export class WebApiNoAccess extends Schema.TaggedError<
  WebApiNoAccess,
  { readonly brand: unique symbol }
>()("WebApiNoAccess", { message: Schema.String, path: Schema.String }) {}

export class WebApiNetworkError extends Schema.TaggedError<
  WebApiNetworkError,
  { readonly brand: unique symbol }
>()("WebApiNetworkError", { message: Schema.String, path: Schema.String }) {}

export class WebApiRateLimited extends Schema.TaggedError<
  WebApiRateLimited,
  { readonly brand: unique symbol }
>()("WebApiRateLimited", {
  message: Schema.String,
  path: Schema.String,
  attempts: Schema.Int,
}) {}

export class WebApiProtocolError extends Schema.TaggedError<
  WebApiProtocolError,
  { readonly brand: unique symbol }
>()("WebApiProtocolError", {
  message: Schema.String,
  path: Schema.String,
  reason: Schema.Literals([
    "status",
    "body",
    "missingVersion",
    "truncated",
    "libraryChanging",
    "deleteLogExpired",
  ]),
  status: Schema.optional(Schema.Int),
}) {}

export class ReplicaStorageError extends Schema.TaggedError<
  ReplicaStorageError,
  { readonly brand: unique symbol }
>()("ReplicaStorageError", {
  message: Schema.String,
  reason: Schema.Literals(["full", "failed"]),
}) {}

export type WebApiError =
  | WebApiNoAccess
  | WebApiNetworkError
  | WebApiRateLimited
  | WebApiProtocolError;

export type WebLibrarySyncError =
  | WebApiKeyInvalid
  | WebApiError
  | ReplicaStorageError;

export function messageOf(cause: unknown): string {
  return Error.isError(cause) ? cause.message : String(cause);
}

export type ReplicaStorageReason = "full" | "failed";

const SQLITE_FULL = 13;

export function describeStorageFailure(
  what: string,
  cause: unknown,
): { readonly reason: ReplicaStorageReason; readonly message: string } {
  let sqlite: Error | undefined;
  for (
    let error: unknown = cause;
    Error.isError(error);
    error = (error as { cause?: unknown }).cause
  ) {
    const { code, resultCode, reason } = error as {
      code?: unknown;
      resultCode?: unknown;
      reason?: unknown;
    };
    if (error.name === "StorageError" && reason === "capacity")
      return {
        reason: "full",
        message: `${what}: the storage is full (${error.message})`,
      };
    if (typeof code === "string" && code.startsWith("SQLITE_")) {
      sqlite ??= error;
      if (
        code === "SQLITE_FULL" ||
        (typeof resultCode === "number" && (resultCode & 0xff) === SQLITE_FULL)
      )
        return {
          reason: "full",
          message: `${what}: the storage is full (${error.message})`,
        };
    }
  }
  return {
    reason: "failed",
    message: `${what}: ${messageOf(sqlite ?? cause)}`,
  };
}
