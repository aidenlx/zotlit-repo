import { describe, expect, it } from "vitest";

import { annotationColor, annotationValue } from "./annotation.ts";

describe("annotation values, as the annotation setters of the client store them", () => {
  it("trims a text, stores it in Unicode normalization form C, and stores no value for an empty text", () => {
    expect(annotationValue("  Café ")).toBe("Café");
    expect(annotationValue("   ")).toBeNull();
    expect(annotationValue("")).toBeNull();
    expect(annotationValue(undefined)).toBeNull();
  });

  it("assigns the default colour to an annotation without a colour, as Zotero's item test expects", () => {
    expect(annotationColor(undefined)).toBe("#ffd400");
    expect(annotationColor(" ")).toBe("#ffd400");
    expect(annotationColor(" #2ea8e5 ")).toBe("#2ea8e5");
  });
});
