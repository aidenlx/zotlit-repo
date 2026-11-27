import { describe, expect, it } from "vitest";

import {
  fieldText,
  normalizeText,
  singleLineFieldValue,
} from "./field-value.ts";

describe("field values, as the setField of the client stores them", () => {
  it("stores an integer as a string, as Zotero's item test expects", () => {
    expect(fieldText(1234)).toBe("1234");
    expect(fieldText(0)).toBe("0");
  });

  it("trims a text and stores it in Unicode normalization form C", () => {
    expect(fieldText("  Café \n")).toBe("Café");
    expect(fieldText(" title\t")).toBe("title");
  });

  it("normalises a name in form C, as Zotero's tags test expects of a tag stored as NFD", () => {
    expect(normalizeText("tag é")).toBe("tag é");
    expect(normalizeText(" A ")).toBe("A");
  });

  it("turns each run of line breaks of a single-line field into one space", () => {
    expect(singleLineFieldValue("title", "One\r\n\nTwo\rThree")).toBe(
      "One Two Three",
    );
    expect(singleLineFieldValue("publisher", "a\nb")).toBe("a b");
  });

  it("keeps the line breaks of the multiline fields of the client", () => {
    for (const field of ["abstractNote", "extra", "address"]) {
      expect(singleLineFieldValue(field, "One\nTwo")).toBe("One\nTwo");
    }
  });
});
