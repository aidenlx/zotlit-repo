import { posix } from "node:path";
import { describe, expect, it } from "vitest";

import { basename, dirname } from "@/lib/vault-path.ts";

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
});
