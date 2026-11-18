import { describe, expect, it } from "vitest";

import { resolveIndexedKeyLibraryIn } from "./zt-key.ts";

describe("resolveIndexedKeyLibraryIn", () => {
  const libraries = [
    { libraryID: 1, groupID: null },
    { libraryID: 7, groupID: 42 },
  ];

  it("resolves a personal key to the user library and a group key to its library", () => {
    expect(resolveIndexedKeyLibraryIn(libraries, "ABCD2345")).toEqual({
      key: "ABCD2345",
      libraryID: 1,
    });
    expect(resolveIndexedKeyLibraryIn(libraries, "ABCD2345g42")).toEqual({
      key: "ABCD2345",
      libraryID: 7,
    });
  });

  it.each(["ABCD2345g99", "lowercase"])("returns null for %s", (key) => {
    expect(resolveIndexedKeyLibraryIn(libraries, key)).toBeNull();
  });
});
