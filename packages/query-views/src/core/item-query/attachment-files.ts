import { Effect, FileSystem } from "effect";

import { attachmentAbsPath } from "@zotlit/db/path";
import type { AttachmentPathContext } from "@zotlit/db/path";
import type { ResolveAttachmentFile } from "@zotlit/item-query";

export interface AttachmentFile {
  readonly path: string | null;
  readonly exists: boolean;
}

export const makeAttachmentFileResolver = Effect.fnUntraced(function* (
  paths: AttachmentPathContext,
): Effect.fn.Return<ResolveAttachmentFile, never, FileSystem.FileSystem> {
  const fs = yield* FileSystem.FileSystem;
  const memo = new Map<number, Effect.Effect<AttachmentFile>>();
  const probe = (path: string | null): Effect.Effect<AttachmentFile> =>
    path === null
      ? Effect.succeed({ path: null, exists: false })
      : fs.exists(path).pipe(
          Effect.orElseSucceed(() => false),
          Effect.map((exists) => ({ path, exists })),
        );
  return Effect.fnUntraced(function* (attachment) {
    const cached = memo.get(attachment.itemID);
    if (cached) return yield* cached;
    const resolved = yield* Effect.cached(
      probe(attachmentAbsPath(attachment, paths)),
    );
    memo.set(attachment.itemID, resolved);
    return yield* resolved;
  });
});
