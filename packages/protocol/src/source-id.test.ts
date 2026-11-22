import { describe, expect, it } from "vitest";

import { normalizeFileUri, sourceIdFromUris } from "./source-id.ts";

describe("normalizeFileUri", () => {
  it("strips a trailing slash (Gecko appends one to existing dirs)", () => {
    expect(normalizeFileUri("file:///Users/me/Zotero/")).toBe(
      "file:///Users/me/Zotero",
    );
  });

  it("upper-cases a Windows drive letter", () => {
    expect(normalizeFileUri("file:///c:/Users/me/Zotero")).toBe(
      "file:///C:/Users/me/Zotero",
    );
  });

  it("applies Unicode NFC", () => {
    const nfd = "file:///Users/café";
    expect(normalizeFileUri(nfd)).toBe("file:///Users/café".normalize("NFC"));
  });
});

describe("sourceIdFromUris", () => {
  it("returns an 8-char lowercase hex string", () => {
    expect(sourceIdFromUris("file:///p", "file:///d")).toMatch(/^[0-9a-f]{8}$/);
  });

  it("matches across Gecko-style and Node-style URIs for the same dirs", () => {
    const gecko = sourceIdFromUris(
      "file:///Users/me/Library/Zotero/Profiles/abcd.default/",
      "file:///Users/me/Zotero/",
    );
    const node = sourceIdFromUris(
      "file:///Users/me/Library/Zotero/Profiles/abcd.default",
      "file:///Users/me/Zotero",
    );
    expect(gecko).toBe(node);
  });

  it("differs when profile or data dir differs", () => {
    const base = sourceIdFromUris("file:///p1", "file:///d1");
    expect(sourceIdFromUris("file:///p2", "file:///d1")).not.toBe(base);
    expect(sourceIdFromUris("file:///p1", "file:///d2")).not.toBe(base);
  });

  it("does not collide across the profile/data boundary", () => {
    expect(sourceIdFromUris("file:///ab", "file:///c")).not.toBe(
      sourceIdFromUris("file:///a", "file:///bc"),
    );
  });
});
