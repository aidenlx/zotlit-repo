import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { buildCanonicalRoots } from "./source.ts";

it.effect(
  "trusts no Zotero storage or cache folder when no local Zotero data directory holds library files",
  () =>
    Effect.gen(function* () {
      const roots = yield* buildCanonicalRoots(
        { dataDir: null, baseAttachmentPath: null, approvedFolders: [] },
        "linux",
      );
      expect(roots).toMatchObject({
        storage: null,
        annotationCache: null,
        base: null,
        approved: [],
      });
    }),
);
