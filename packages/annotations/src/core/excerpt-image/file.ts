import { Effect, Fiber, FileSystem, Option, Scope } from "effect";

import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
const logged = withLogCategory("excerpt-image", "file");

export function pdfStamp(info: FileSystem.File.Info) {
  return {
    size: Number(info.size),
    mtimeMs: Option.match(info.mtime, {
      onNone: () => 0,
      onSome: (mtime) => mtime.getTime(),
    }),
  };
}

export const readBounded = Effect.fnUntraced(function* (
  file: FileSystem.File,
  size: number,
) {
  const bytes = new Uint8Array(size);
  let offset = 0;
  while (offset < bytes.length) {
    const count = yield* file.read(bytes.subarray(offset));
    if (!count) break;
    offset += count;
  }
  return bytes.subarray(0, offset);
});

export const openExcerptFile = Effect.fnUntraced(function* (path: string) {
  const fs = yield* FileSystem.FileSystem;
  return yield* Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      const fileScope = yield* Scope.make();
      const opening = yield* fs
        .open(path)
        .pipe(Effect.provideService(Scope.Scope, fileScope), Effect.forkDetach);
      yield* Effect.addFinalizer((exit) =>
        Effect.gen(function* () {
          const cleanup = yield* Fiber.interrupt(opening).pipe(
            Effect.ensuring(Scope.close(fileScope, exit)),
            Effect.catchCause((cause) =>
              Effect.logDebug("Excerpt file cleanup failed").pipe(
                Effect.annotateLogs({ path, cause }),
                logged,
              ),
            ),
            Effect.forkDetach,
          );
          yield* Fiber.join(cleanup).pipe(
            Effect.timeoutOption(5_000),
            Effect.asVoid,
          );
        }),
      );
      return yield* restore(Fiber.join(opening));
    }),
  );
});
