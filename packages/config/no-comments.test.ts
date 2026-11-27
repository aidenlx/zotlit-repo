import assert from "node:assert/strict";
import { test } from "node:test";

import { gainedEntries, scan } from "./no-comments.ts";

void test("lets a baseline entry move to another file, and refuses a new or copied one", () => {
  const previous = { "old.e2e.ts": "aaa bbb", "kept.ts": "ccc" };
  assert.deepEqual(
    gainedEntries(previous, {
      "area-1.e2e.ts": "aaa",
      "area-2.e2e.ts": "bbb",
      "kept.ts": "ccc",
    }),
    [],
  );
  assert.deepEqual(
    gainedEntries(previous, { "area-1.e2e.ts": "aaa ddd", "kept.ts": "ccc" }),
    ["area-1.e2e.ts"],
  );
  assert.deepEqual(
    gainedEntries(previous, {
      "old.e2e.ts": "aaa bbb",
      "copy.e2e.ts": "aaa",
      "kept.ts": "ccc",
    }),
    ["copy.e2e.ts"],
  );
});

void test("counts comment tokens and physical lines in TSX", () => {
  const source = [
    'const url = "https://example.com/🤷"; // trailing',
    "const markup = <div>{/* JSX */}</div>;",
    "const marker = /\\/\\/literal/;",
    "/** doc",
    " * detail",
    " */",
    "const value = /* first */ 1 /* second */;",
  ].join("\n");

  assert.deepEqual(scan("example.tsx", source), {
    comments: [
      { file: "example.tsx", line: 1, endLine: 1, text: "// trailing" },
      { file: "example.tsx", line: 2, endLine: 2, text: "/* JSX */" },
      {
        file: "example.tsx",
        line: 4,
        endLine: 6,
        text: "/** doc\n * detail\n */",
      },
      { file: "example.tsx", line: 7, endLine: 7, text: "/* first */" },
      { file: "example.tsx", line: 7, endLine: 7, text: "/* second */" },
    ],
    commentOnlyLines: 3,
    mixedLines: 3,
  });
});

void test("counts inline CSS comments and leaves quoted markers alone", () => {
  const result = scan(
    "example.css",
    '\uFEFF/* first */\na { color: /* inline */ red; content: "/* string */"; }',
  );
  assert.deepEqual(result, {
    comments: [
      { file: "example.css", line: 1, endLine: 1, text: "/* first */" },
      { file: "example.css", line: 2, endLine: 2, text: "/* inline */" },
    ],
    commentOnlyLines: 1,
    mixedLines: 1,
  });
});

void test("counts YAML comments and preserves hashes inside scalar values", () => {
  const source = [
    "# first",
    'quoted: "# string" # trailing',
    "script: |",
    "  # script content",
    "flow: [one, # item",
    "  two]",
    "---",
    "# next document",
  ].join("\n");

  assert.deepEqual(scan("example.yml", source), {
    comments: [
      { file: "example.yml", line: 1, endLine: 1, text: "# first" },
      { file: "example.yml", line: 2, endLine: 2, text: "# trailing" },
      { file: "example.yml", line: 5, endLine: 5, text: "# item" },
      { file: "example.yml", line: 8, endLine: 8, text: "# next document" },
    ],
    commentOnlyLines: 2,
    mixedLines: 2,
  });
});

void test("counts JSON comments and preserves URL and fixture strings", () => {
  const source = [
    "{",
    '  "url": "https://example.com", // trailing',
    '  "fixture": "/* literal */",',
    "  /* block",
    "     continuation */",
    '  "value": 1',
    "}",
  ].join("\n");

  assert.deepEqual(scan("example.jsonc", source), {
    comments: [
      { file: "example.jsonc", line: 2, endLine: 2, text: "// trailing" },
      {
        file: "example.jsonc",
        line: 4,
        endLine: 5,
        text: "/* block\n     continuation */",
      },
    ],
    commentOnlyLines: 2,
    mixedLines: 1,
  });
});
