import { describe, expect, it } from "vitest";

import { sha256Hex } from "./sha256.ts";

import { snapshotRevision } from "#desktop/snapshot-revision.ts";

describe("sha256Hex", () => {
  it("gives the digest of node:crypto, the revision of the desktop host", () => {
    for (const text of [
      "",
      "abc",
      "a".repeat(55),
      "a".repeat(56),
      "a".repeat(64),
      "a".repeat(1000),
      JSON.stringify({ title: "論文 📚", date: "2024" }),
    ]) {
      expect(sha256Hex(text)).toBe(snapshotRevision(text));
    }
  });
});
