import type { ExportFiles } from "#core/item-query/export-files.ts";
import { regex } from "arkregex";
import {
  Cause,
  Duration,
  Effect,
  Exit,
  FileSystem,
  PlatformError,
  Scope,
  Stream,
} from "effect";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";

import {
  isOlderThan,
  isProcessLive,
  sweepTempDirectory,
} from "@zotlit/obsidian-desktop/temp-sweep.ts";

import { ExportFileError } from "#core/item-query/export-files.ts";

const STAGING_NAME = regex(
  "\\.(?<pid>[1-9]\\d*)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.zotlit-partial$",
);

const STAGING_MAX_AGE = Duration.hours(1);

type StagingState =
  | { readonly _tag: "Empty" }
  | {
      readonly _tag: "Open";
      readonly file: FileSystem.File;
      readonly bytes: number;
    };

export function nodeExportFiles(fs: FileSystem.FileSystem): ExportFiles {
  return {
    write: (path, document) =>
      Effect.suspend(() => {
        const staging = `${path}.${process.pid}-${randomUUID()}.zotlit-partial`;
        return Effect.uninterruptibleMask((restore) =>
          restore(Effect.scoped(fill(fs, { path, staging, document }))).pipe(
            Effect.tap(() => io(fs.link(staging, path))),
            Effect.ensuring(discard(fs, staging)),
          ),
        );
      }),
  };
}

function fill<E, R>(
  fs: FileSystem.FileSystem,
  {
    path,
    staging,
    document,
  }: {
    path: string;
    staging: string;
    document: Stream.Stream<Uint8Array, E, R>;
  },
) {
  return Effect.gen(function* () {
    const fileScope = yield* Effect.acquireRelease(Scope.make(), (scope) =>
      Scope.close(scope, Exit.void).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning(
            "ZotLit Query could not close its staging file {path}",
          ).pipe(
            Effect.annotateLogs({ path: staging, cause: Cause.pretty(cause) }),
          ),
        ),
      ),
    );
    const state = yield* Stream.runFoldEffect(
      document,
      (): StagingState => ({ _tag: "Empty" }),
      (state, chunk) =>
        Effect.gen(function* () {
          const open =
            state._tag === "Open" ? state : yield* openStaging(fileScope);
          yield* io(open.file.writeAll(chunk)).pipe(Effect.uninterruptible);
          return { ...open, bytes: open.bytes + chunk.byteLength };
        }),
    );
    if (state._tag === "Empty")
      return yield* Effect.die(new Error("An export document has no chunk"));
    yield* closeStaging(fileScope);
    return state.bytes;
  });

  function openStaging(fileScope: Scope.Scope) {
    return Effect.gen(function* () {
      yield* sweepStaging(dirname(path)).pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
      );
      const file = yield* io(
        fs
          .open(staging, { flag: "wx", mode: 0o600 })
          .pipe(Scope.provide(fileScope)),
      );
      return { _tag: "Open", file, bytes: 0 } satisfies StagingState;
    });
  }
}

function closeStaging(
  fileScope: Scope.Closeable,
): Effect.Effect<void, ExportFileError> {
  return Effect.exit(Scope.close(fileScope, Exit.void)).pipe(
    Effect.flatMap((exit) => {
      if (Exit.isSuccess(exit)) return Effect.void;
      const failure = Cause.squash(exit.cause);
      return PlatformError.isPlatformError(failure)
        ? io(Effect.fail(failure))
        : Effect.die(failure);
    }),
  );
}

function sweepStaging(directory: string) {
  return sweepTempDirectory({
    directory,
    kind: "export staging file",
    entries: "files",
    isResidue: (name, path) => {
      const pid = STAGING_NAME.exec(name)?.groups.pid;
      if (pid === undefined) return Effect.succeed(false);
      return isProcessLive(Number(pid)).pipe(
        Effect.flatMap((live) =>
          live ? Effect.succeed(false) : isOlderThan(path, STAGING_MAX_AGE),
        ),
      );
    },
  });
}

function discard(fs: FileSystem.FileSystem, staging: string) {
  return fs
    .remove(staging, { force: true })
    .pipe(
      Effect.catch((error) =>
        Effect.logWarning(
          "ZotLit Query could not remove its staging file {path}",
        ).pipe(Effect.annotateLogs({ path: staging, error })),
      ),
    );
}

function io<A, R>(
  step: Effect.Effect<A, PlatformError.PlatformError, R>,
): Effect.Effect<A, ExportFileError, R> {
  return step.pipe(
    Effect.catchTag("PlatformError", (error) => {
      if (error.reason._tag === "BadArgument") return Effect.die(error);
      const cause = error.reason.cause;
      return Effect.fail(
        new ExportFileError({
          message: Error.isError(cause) ? cause.message : error.message,
        }),
      );
    }),
  );
}
