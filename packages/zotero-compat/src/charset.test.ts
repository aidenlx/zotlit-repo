import { describe, expect, it } from "vitest";

import { canonicalCharset } from "./charset.ts";

describe("the character set of an attachment, as the client's attachmentCharset setter stores it", () => {
  it("gives the canonical name of a WHATWG label, after a trim and in any case, as Zotero.CharacterSets.toCanonical does", () => {
    expect(canonicalCharset(" Latin1 ")).toBe("windows-1252");
    expect(canonicalCharset("ISO-8859-1")).toBe("windows-1252");
    expect(canonicalCharset("UTF8")).toBe("utf-8");
    expect(canonicalCharset("utf-16")).toBe("utf-16le");
    expect(canonicalCharset("x-mac-ukrainian")).toBe("x-mac-cyrillic");
    expect(canonicalCharset("Shift-JIS")).toBe("shift_jis");
    expect(canonicalCharset("hz-gb-2312")).toBe("replacement");
    expect(canonicalCharset("big5-hkscs")).toBe("big5-hkscs");
  });

  it("gives no character set for an unknown label or an empty one, which the client stores as none", () => {
    expect(canonicalCharset("made-up")).toBeNull();
    expect(canonicalCharset("")).toBeNull();
    expect(canonicalCharset(undefined)).toBeNull();
  });
});
