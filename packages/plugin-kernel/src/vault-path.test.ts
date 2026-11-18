import { posix } from "node:path";
import { describe, expect, it } from "vitest";

import { basename, dirname, join } from "#vault-path.ts";

// Failure mode: the copy drifts from Node's algorithm, so a vault path splits
// differently than it did through `node:path/posix`.
const PATHS = [
  "",
  "a",
  "a.md",
  "folder/a.md",
  "folder/sub/a.md",
  "folder/",
  "folder//",
  "folder//a.md",
  "/",
  "//",
  "///",
  "/a",
  "//a",
  "/a/b/",
  ".",
  "..",
  "./a",
  "a/./b",
  "a/../b",
  " spaced folder/ note .md",
  "笔记/文献.md",
  "a\\b/c.md",
];

describe("vault-path", () => {
  it.each(PATHS)("splits %j as Node's posix path does", (path) => {
    expect([basename(path), dirname(path)]).toEqual([
      posix.basename(path),
      posix.dirname(path),
    ]);
  });

  // Failure mode: a folder and a file name join to another vault path than
  // `node:path/posix` gave, so a Profile or template document moves.
  it.each(PATHS.flatMap((folder) => PATHS.map((name) => [folder, name])))(
    "joins %j and %j as Node's posix path does",
    (folder, name) => {
      expect(join(folder, name)).toBe(posix.join(folder, name));
    },
  );

  it.each([
    { segments: [] },
    { segments: ["a"] },
    { segments: ["a", "", "b"] },
    { segments: ["../a", "../../b", "c/.."] },
  ])("joins $segments as Node's posix path does", ({ segments }) => {
    expect(join(...segments)).toBe(posix.join(...segments));
  });
});
