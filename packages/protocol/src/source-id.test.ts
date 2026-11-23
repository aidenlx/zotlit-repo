import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

import {
  acceptedSourceIds,
  normalizeFileUri,
  sourceIdFromUris,
} from "./source-id.ts";

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

describe("acceptedSourceIds", () => {
  const toFileUri = (path: string) => pathToFileURL(path).href;
  const profile =
    "/Users/me/Library/Application Support/Zotero/Profiles/abcd.default";
  const composed = "/Users/me/Caf\u00e9/Zotero";
  const decomposed = "/Users/me/Cafe\u0301/Zotero";
  const writer = (profilePath: string, dataPath: string) =>
    sourceIdFromUris(toFileUri(profilePath), toFileUri(dataPath));

  it("lists the writer's Source Id for the paths as given first", () => {
    expect(acceptedSourceIds(profile, composed, toFileUri)[0]).toBe(
      writer(profile, composed),
    );
  });

  it("accepts an id written from the decomposed spelling of a composed path", () => {
    expect(writer(profile, decomposed)).not.toBe(writer(profile, composed));
    expect(acceptedSourceIds(profile, composed, toFileUri)).toContain(
      writer(profile, decomposed),
    );
  });

  it("accepts an id written from the composed spelling of a decomposed path", () => {
    expect(acceptedSourceIds(profile, decomposed, toFileUri)).toContain(
      writer(profile, composed),
    );
  });

  it("rejects an id written from an unrelated data directory", () => {
    expect(acceptedSourceIds(profile, composed, toFileUri)).not.toContain(
      writer(profile, "/Users/me/Other/Zotero"),
    );
  });

  it("keeps the Source Id of the default macOS profile path", () => {
    expect(
      sourceIdFromUris(
        "file:///Users/me/Library/Application%20Support/Zotero/Profiles/abcd.default",
        "file:///Users/me/Zotero",
      ),
    ).toBe("74b09171");
    expect(acceptedSourceIds(profile, "/Users/me/Zotero", toFileUri)).toEqual([
      "74b09171",
    ]);
  });
});
