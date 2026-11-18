import type {
  CitationOccurrence,
  DocumentCitationError,
} from "#obsidian/citation-index/service.ts";
import { describe, expect, it } from "vitest";

import { buildReferenceEntries } from "./entries.ts";

describe("buildReferenceEntries citation source errors", () => {
  it("keeps a malformed Citation Fragment as an unnumbered exact error", () => {
    const occurrence: CitationOccurrence = {
      kind: "wikilink",
      raw: "Rivers 2020",
      position: {
        start: { line: 4, col: 2, offset: 42 },
        end: { line: 4, col: 39, offset: 79 },
      },
    };
    const error: DocumentCitationError = {
      kind: "malformed-wikilink",
      occurrence,
    };

    expect(
      buildReferenceEntries([], {
        bibliography: { entries: new Map(), complete: true },
        errors: [error],
      }),
    ).toStrictEqual([
      {
        id: "malformed:42",
        occurrences: [occurrence],
        kind: "malformed",
      },
    ]);
  });
});
