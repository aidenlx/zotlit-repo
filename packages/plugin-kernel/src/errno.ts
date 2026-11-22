import { Effect, PlatformError } from "effect";

export function isErrno(error: unknown, code: string): boolean {
  return (
    Error.isError(error) &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

export function isNotFound(error: unknown): boolean {
  return (
    PlatformError.isPlatformError(error) && error.reason._tag === "NotFound"
  );
}

export function isPlatformErrno(error: unknown, code: string): boolean {
  return PlatformError.isPlatformError(error) && isErrno(error.cause, code);
}

function errnoReason(cause: unknown): PlatformError.SystemErrorTag {
  if (isErrno(cause, "ENOENT")) return "NotFound";
  if (isErrno(cause, "EACCES")) return "PermissionDenied";
  if (isErrno(cause, "EEXIST")) return "AlreadyExists";
  if (
    isErrno(cause, "EISDIR") ||
    isErrno(cause, "ENOTDIR") ||
    isErrno(cause, "ELOOP")
  )
    return "BadResource";
  if (isErrno(cause, "EBUSY")) return "Busy";
  return "Unknown";
}

export const nodeFileSystemCall = <A>(
  method: string,
  path: string,
  evaluate: () => Promise<A>,
): Effect.Effect<A, PlatformError.PlatformError> =>
  Effect.tryPromise({
    try: evaluate,
    catch: (cause) =>
      PlatformError.systemError({
        _tag: errnoReason(cause),
        module: "FileSystem",
        method,
        syscall: Error.isError(cause)
          ? (cause as { syscall?: string }).syscall
          : undefined,
        pathOrDescriptor: path,
        cause,
      }),
  });
