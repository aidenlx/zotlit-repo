import type { AmbiguousCandidate } from "#obsidian/citation-index/ambiguity.ts";

export const ambiguousCandidates: readonly AmbiguousCandidate[] = [
  {
    itemID: 11,
    libraryID: 1,
    key: "DOE2024A",
    indexedKey: "DOE2024A",
    summary: "Doe (2024): A study of citations",
    library: { selector: { type: "personal" }, libraryID: 1, name: null },
  },
  {
    itemID: 12,
    libraryID: 4,
    key: "DOE2024B",
    indexedKey: "4/DOE2024B",
    summary: "Doe (2024): Another study",
    library: {
      selector: { type: "group", groupID: 7 },
      libraryID: 4,
      name: "Shared group",
    },
  },
];
