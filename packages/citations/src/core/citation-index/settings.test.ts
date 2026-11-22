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
      "de-u-co-phonebk",
      "zh-cmn-Hans-CN",
      "x-pmr",
      "i-klingon",
      "en-GB-oed",
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
      "de-1901-1901",
      "en-u-ca-gregory-u-nu-latn",
    ]) {
      expect(citationLocaleError(locale)).toBe(
        m.settings_citation_locale_invalid(),
      );
    }
  });
});
