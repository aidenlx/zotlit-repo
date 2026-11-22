import { Effect, FileSystem, Option, Schema } from "effect";
import type { PlatformError } from "effect";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, lstat } from "node:fs/promises";
import { dirname, join } from "node:path";

import { reflink } from "@zotlit/obsidian-desktop/reflink.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import { nodeFileSystemCall } from "@zotlit/plugin-kernel/errno.ts";

const logged = withLogCategory("attachment-import");

const CHUNK_SIZE = 64 * 1024;

export type AttachmentCopySource =
  | { kind: "path"; path: string }
  | { kind: "handle"; handle: FileSystem.File };

export interface AttachmentCopyItem {
  source: AttachmentCopySource;
  dest: string;
}

export interface AttachmentCopyResult {
  copied: number;
  skipped: number;
  missing: number;
}

export class DestinationSymlinkError extends Schema.TaggedError<
  DestinationSymlinkError,
  { readonly brand: unique symbol }
>()("DestinationSymlinkError", { dest: Schema.String }) {
  override get message(): string {
    return `Refusing to write through existing symbolic link at destination: ${this.dest}`;
  }
}

export type AttachmentCopyFailure =
  | PlatformError.PlatformError
  | DestinationSymlinkError;

export const copyAttachments = Effect.fnUntraced(function* (
  items: readonly AttachmentCopyItem[],
): Effect.fn.Return<
  AttachmentCopyResult,
  AttachmentCopyFailure,
  FileSystem.FileSystem
> {
  const result: AttachmentCopyResult = { copied: 0, skipped: 0, missing: 0 };
  for (const item of items) {
    result[yield* copyAttachment(item)] += 1;
  }
  return result;
});

const copyAttachment = ({
  source,
  dest,
}: AttachmentCopyItem): Effect.Effect<
  keyof AttachmentCopyResult,
  AttachmentCopyFailure,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const sourceInfo =
      source.kind === "handle"
        ? yield* source.handle.stat
        : yield* fs.stat(source.path);
    if (yield* destMatches(sourceInfo, dest)) return "skipped" as const;
    yield* writeCopy(source, dest, sourceInfo);
    return "copied" as const;
  }).pipe(
    Effect.catchReason("PlatformError", "NotFound", (_reason, error) =>
      Effect.logWarning("Skipped attachment with missing source").pipe(
        Effect.annotateLogs({ dest, error }),
        logged,
        Effect.as("missing" as const),
      ),
    ),
  );

const writeCopy = (
  source: AttachmentCopySource,
  dest: string,
  sourceInfo: FileSystem.File.Info,
): Effect.Effect<void, PlatformError.PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const tempPath = join(dirname(dest), `.${randomUUID()}.zotlit-tmp`);
    yield* Effect.gen(function* () {
      yield* copyIntoTemp(source, tempPath);
      const times = Option.all([sourceInfo.atime, sourceInfo.mtime]);
      if (Option.isSome(times)) {
        const [atime, mtime] = times.value;
        yield* fs.utimes(tempPath, atime, mtime);
      }
      yield* fs.rename(tempPath, dest);
    }).pipe(Effect.tapCause(() => fs.remove(tempPath, { force: true })));
  }).pipe(Effect.uninterruptible);

const copyIntoTemp = (
  source: AttachmentCopySource,
  tempPath: string,
): Effect.Effect<void, PlatformError.PlatformError, FileSystem.FileSystem> => {
  if (source.kind === "handle") {
    return Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const target = yield* fs.open(tempPath, { flag: "wx" });
        let position = 0n;
        while (true) {
          const chunk = yield* source.handle.readAlloc(CHUNK_SIZE, {
            position,
          });
          if (Option.isNone(chunk)) return;
          yield* target.writeAll(chunk.value);
          position += BigInt(chunk.value.byteLength);
        }
      }),
    );
  }
  return Effect.tryPromise(() => reflink(source.path, tempPath)).pipe(
    Effect.catch(() =>
      nodeFileSystemCall("copyFile", source.path, () =>
        copyFile(source.path, tempPath, constants.COPYFILE_EXCL),
      ),
    ),
  );
};

const destMatches = (
  sourceInfo: FileSystem.File.Info,
  dest: string,
): Effect.Effect<boolean, AttachmentCopyFailure> =>
  nodeFileSystemCall("lstat", dest, () => lstat(dest, { bigint: true })).pipe(
    Effect.flatMap((destStat) =>
      destStat.isSymbolicLink()
        ? Effect.fail(new DestinationSymlinkError({ dest }))
        : Effect.succeed(
            sourceInfo.size === destStat.size &&
              Option.exists(
                sourceInfo.mtime,
                (mtime) => mtime.getTime() === destStat.mtime.getTime(),
              ),
          ),
    ),
    Effect.catchReason("PlatformError", "NotFound", () =>
      Effect.succeed(false),
    ),
  );
