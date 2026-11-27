import { expect, it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";

import type { Attachment } from "@zotlit/db";

import { makeAttachmentFileResolver } from "./attachment-files.ts";

const stored = {
  itemID: 7,
  key: "ATCH2345",
  path: "storage:paper.pdf",
  linkMode: 0,
} as Attachment;

it.effect(
  "reports a file as not available, and probes no disk, when no local Zotero data directory holds it",
  () =>
    Effect.gen(function* () {
      let probes = 0;
      const resolve = yield* makeAttachmentFileResolver({
        dataDir: null,
        baseAttachmentPath: null,
      }).pipe(
        Effect.provideService(
          FileSystem.FileSystem,
          FileSystem.makeNoop({
            exists: () =>
              Effect.sync(() => {
                probes++;
                return true;
              }),
          }),
        ),
      );
      expect(yield* resolve(stored)).toEqual({ path: null, exists: false });
      expect(probes).toBe(0);
    }),
);
