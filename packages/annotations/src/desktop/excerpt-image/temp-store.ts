import { Cause, Clock, Effect, FileSystem } from "effect";
import { createHash, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";

export function excerptTempDirectory(parent = tmpdir()): string {
  return join(parent, "zotlit-excerpts");
}

export const publishExcerptPng = Effect.fnUntraced(
  function* (
    fingerprint: string,
    bytes: Uint8Array,
    directory = excerptTempDirectory(),
  ) {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.makeDirectory(directory, { recursive: true });
    const address = createHash("sha256")
      .update(fingerprint)
      .update(bytes)
      .digest("hex");
    const path = join(directory, `${address}.png`);
    const staging = yield* Effect.acquireRelease(
      Effect.sync(() =>
        join(directory, `.${fingerprint}-${randomUUID()}.part`),
      ),
      (file) =>
        fs
          .remove(file, { force: true })
          .pipe(
            Effect.catch((error) =>
              Effect.logWarning(
                "Cannot remove staged excerpt PNG",
                Cause.fail(error),
              ).pipe(Effect.annotateLogs({ file })),
            ),
          ),
    );
    yield* Effect.uninterruptible(fs.writeFile(staging, bytes, { flag: "wx" }));
    yield* fs
      .link(staging, path)
      .pipe(
        Effect.catchReason("PlatformError", "AlreadyExists", () => Effect.void),
      );
    const now = (yield* Clock.currentTimeMillis) / 1000;
    yield* fs.utimes(path, now, now);
    return path;
  },
  Effect.scoped,
  withLogCategory("excerpt-image"),
);
