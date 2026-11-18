import { describe, expect, it } from "vitest";

import * as m from "@zotlit/plugin-messages/messages.ts";

import { citationLocaleError } from "./settings.ts";

describe("citationLocaleError", () => {
  it("accepts the locale forms Pandoc and CSL read", () => {
    for (const locale of [
      "",
      "de",
      "en-US",
      "pt-BR",
      "zh-Hans-CN",
      "es-419",
      // Pandoc sorts a bibliography by the collation this extension names.
      "de-u-co-phonebk",
      // The extended language, private-use, and irregular tags BCP 47 keeps.
      "zh-cmn-Hans-CN",
      "x-pmr",
      "i-klingon",
      "en-GB-oed",
      // Case carries no meaning in a language tag, irregular ones included.
      "I-KLINGON",
      "SGN-BE-FR",
      "DE-de",
    ]) {
      expect(citationLocaleError(locale)).toBeUndefined();
    }
  });

  it("names the form an unreadable locale should take", () => {
    for (const locale of [
      "en_US",
      "en US",
      " de-DE",
      "1234",
      "de-",
      "de--DE",
      "abcdefghi",
      // A tag writes each variant and each extension once.
      "de-1901-1901",
      "en-u-ca-gregory-u-nu-latn",
    ]) {
      expect(citationLocaleError(locale)).toBe(
        m.settings_citation_locale_invalid(),
      );
    }
  });
});
