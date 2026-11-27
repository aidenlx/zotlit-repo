import { Effect, Option } from "effect";

import type { AttachmentPathContext } from "@zotlit/db/path";

import { LibrarySource } from "./tag.ts";

import { ZoteroPref } from "#core/zotero-pref/service.ts";

export const NO_LOCAL_LIBRARY_FILES: AttachmentPathContext = {
  dataDir: null,
  baseAttachmentPath: null,
};

export const libraryFilePaths: Effect.Effect<
  AttachmentPathContext,
  never,
  ZoteroPref
> = Effect.gen(function* () {
  const source = yield* Effect.serviceOption(LibrarySource);
  if (Option.isSome(source) && source.value.active !== "file")
    return NO_LOCAL_LIBRARY_FILES;
  const { dataDir, baseAttachmentPath } = yield* (yield* ZoteroPref).current;
  return { dataDir, baseAttachmentPath };
});
