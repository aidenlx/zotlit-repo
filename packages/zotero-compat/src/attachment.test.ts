import { describe, expect, it } from "vitest";

import { attachmentLastRead, attachmentPath } from "./attachment.ts";

describe("attachment values, as the fromJSON of the client stores them", () => {
  it("prefixes the file name of a stored file with storage:, as Zotero's item test expects", () => {
    expect(attachmentPath("imported_file", { filename: "test.png" })).toBe(
      "storage:test.png",
    );
    expect(attachmentPath("imported_url", { filename: "page.html" })).toBe(
      "storage:page.html",
    );
  });

  it("keeps the path of a linked file, and stores no path for a link or an empty name", () => {
    expect(
      attachmentPath("linked_file", {
        path: "/Users/a/b.pdf",
        filename: "b.pdf",
      }),
    ).toBe("/Users/a/b.pdf");
    expect(attachmentPath("linked_file", { path: "" })).toBeNull();
    expect(attachmentPath("linked_url", { filename: "x.html" })).toBeNull();
    expect(attachmentPath("imported_file", { filename: "" })).toBeNull();
    expect(attachmentPath("imported_file", {})).toBeNull();
  });

  it("reads the read time as an integer, and stores none when the record has none, as Zotero's item test expects", () => {
    expect(attachmentLastRead(123450000)).toBe(123450000);
    expect(attachmentLastRead("123450000")).toBe(123450000);
    expect(attachmentLastRead(undefined)).toBeNull();
    expect(attachmentLastRead(0)).toBeNull();
    expect(attachmentLastRead("soon")).toBeNull();
  });
});
