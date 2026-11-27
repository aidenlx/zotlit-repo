import { Effect } from "effect";

import { DbUnavailable } from "@zotlit/zotero-reads/contract/rpc.ts";

const absent = (cause: unknown) =>
  cause instanceof DOMException && cause.name === "NotFoundError";

export const removeOriginDirectory = Effect.fn(
  "LibrarySource.removeOriginDirectory",
)(function* (path: string) {
  const parts = path.split("/").filter(Boolean);
  const name = parts.pop();
  if (!name) return;
  yield* Effect.tryPromise({
    try: async () => {
      try {
        let directory = await navigator.storage.getDirectory();
        for (const part of parts)
          directory = await directory.getDirectoryHandle(part);
        await directory.removeEntry(name, { recursive: true });
      } catch (cause) {
        if (!absent(cause)) throw cause;
      }
    },
    catch: (cause) =>
      new DbUnavailable({
        message: `The online library data could not be removed: ${String(cause)}`,
      }),
  });
});
