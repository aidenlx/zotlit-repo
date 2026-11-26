import { Cause, Clock, Duration, Effect, FileSystem, Option } from "effect";
import type { PlatformError } from "effect";
import { join } from "node:path";

import { withLogCategory } from "@zotlit/plugin-kernel/worker/effect-log-category.ts";

export interface ReapTempsOptions {
  parent?: string;
}

export interface TempSweepOptions<R> {
  directory: string;
  kind: string;
  isResidue: (
    name: string,
    path: string,
  ) => Effect.Effect<boolean, PlatformError.PlatformError, R>;
}

export const sweepTempDirectory = Effect.fnUntraced(function* <R>({
  directory,
  kind,
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
    yield* isResidue(name, path).pipe(
      Effect.matchEffect({
        onSuccess: (residue) =>
          residue ? remove(fs, path, kind) : Effect.void,
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

function remove(fs: FileSystem.FileSystem, path: string, kind: string) {
  return fs.remove(path, { recursive: true, force: true }).pipe(
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
