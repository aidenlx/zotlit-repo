import { describe, expect, it } from "vitest";

import { citationExampleData } from "./citation-examples.ts";

describe("citation example sets", () => {
  it("leaves the note-root properties off a cited item and keeps its Zotero fields", () => {
    const [citation] = citationExampleData("one-item", "main").citations;
    const item = citation!.item;
    for (const absent of [
      "key",
      "indexedKey",
      "libraryID",
      "groupID",
      "dateAdded",
      "dateModified",
      "tags",
      "notePath",
      "noteLink",
      "authors",
      "authorsShort",
      "collections",
    ]) {
      expect(item).not.toHaveProperty(absent);
    }
    expect(item.publicationTitle).toBe("PLoS Medicine");
    expect(item.containerTitle).toBe("PLoS Medicine");
  });
});
