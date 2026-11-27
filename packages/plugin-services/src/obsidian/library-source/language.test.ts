import { describe, expect, it } from "vitest";

import { effectiveZoteroLanguage } from "./language.ts";

describe("the Zotero language", () => {
  it.each([
    ["en-DE", "en-US"],
    ["en-GB", "en-GB"],
    ["de-AT", "de"],
    ["tlh-KL", "en-US"],
  ])(
    "gives Zotero's language for the system language %s when Automatic",
    (system, zotero) => {
      expect(effectiveZoteroLanguage("auto", system)).toBe(zotero);
    },
  );

  it("gives en-US when the system gives no language", () => {
    expect(effectiveZoteroLanguage("auto", null)).toBe("en-US");
  });

  it("gives the chosen language over the system language", () => {
    expect(effectiveZoteroLanguage("fr-FR", "en-GB")).toBe("fr-FR");
  });
});
