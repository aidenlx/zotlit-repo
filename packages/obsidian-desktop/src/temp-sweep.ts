import type { PlatformError } from "effect";
import { Cause, Clock, Duration, Effect, FileSystem, Option } from "effect";
import { join } from "node:path";

import { isErrno } from "@zotlit/plugin-kernel/errno.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/worker/effect-log-category.ts";

export interface ReapTempsOptions {
  parent?: string;
}

export interface TempSweepOptions<R> {
  directory: string;
  kind: string;
  entries?: "files";
  isResidue: (
    name: string,
    path: string,
  ) => Effect.Effect<boolean, PlatformError.PlatformError, R>;
}

export const sweepTempDirectory = Effect.fnUntraced(function* <R>({
  directory,
  kind,
  entries,
  isResidue,
}: TempSweepOptions<R>) {
  const fs = yield* FileSystem.FileSystem;
  const names = yield* fs.readDirectory(directory).pipe(
    Effect.catchReason("PlatformError", "NotFound", () =>
      Effect.succeed<string[]>([]),
    ),
    Effect.catch((error) =>
      Effect.logWarning(
        "Failed to sweep a ZotLit temp directory",
        Cause.fail(error),
      ).pipe(
        Effect.annotateLogs({ directory, kind }),
        withLogCategory("temp-sweep"),
        Effect.as<string[]>([]),
      ),
    ),
  );
  for (const name of names) {
    const path = join(directory, name);
    const residue =
      entries === "files"
        ? Effect.flatMap(isResidue(name, path), (candidate) =>
            candidate ? isFile(fs, path) : Effect.succeed(false),
          )
        : isResidue(name, path);
    yield* residue.pipe(
      Effect.matchEffect({
        onSuccess: (residue) =>
          residue
            ? remove(fs, path, { kind, recursive: entries !== "files" })
            : Effect.void,
        onFailure: (error) =>
          Effect.logWarning(
            "Failed to check a ZotLit temp entry",
            Cause.fail(error),
          ).pipe(
            Effect.annotateLogs({ path, kind }),
            withLogCategory("temp-sweep"),
          ),
      }),
    );
  }
});

export const isOlderThan = Effect.fnUntraced(function* (
  path: string,
  maxAge: Duration.Duration,
) {
  const fs = yield* FileSystem.FileSystem;
  const info = yield* fs.stat(path).pipe(
    Effect.asSome,
    Effect.catchReason("PlatformError", "NotFound", () => Effect.succeedNone),
  );
  const mtime = Option.flatMap(info, ({ mtime }) => mtime);
  if (Option.isNone(mtime)) return false;
  const now = yield* Clock.currentTimeMillis;
  return Duration.isGreaterThan(
    Duration.millis(now - mtime.value.getTime()),
    maxAge,
  );
});

export function isProcessLive(pid: number): Effect.Effect<boolean> {
  return Effect.try({
    try: () => process.kill(pid, 0),
    catch: (error) => isErrno(error, "EPERM"),
  }).pipe(
    Effect.as(true),
    Effect.catch((ownedByAnotherUser) => Effect.succeed(ownedByAnotherUser)),
  );
}

function isFile(fs: FileSystem.FileSystem, path: string) {
  return fs.lstat(path).pipe(
    Effect.map(({ type }) => type === "File"),
    Effect.catchReason("PlatformError", "NotFound", () =>
      Effect.succeed(false),
    ),
  );
}

function remove(
  fs: FileSystem.FileSystem,
  path: string,
  { kind, recursive }: { kind: string; recursive: boolean },
) {
  return fs.remove(path, { recursive, force: true }).pipe(
    Effect.matchEffect({
      onSuccess: () =>
        Effect.logDebug("Reaped a stale ZotLit temp entry").pipe(
          Effect.annotateLogs({ path, kind }),
          withLogCategory("temp-sweep"),
        ),
      onFailure: (error) =>
        Effect.logWarning(
          "Failed to reap a stale ZotLit temp entry",
          Cause.fail(error),
        ).pipe(
          Effect.annotateLogs({ path, kind }),
          withLogCategory("temp-sweep"),
        ),
    }),
  );
}
