import { describe, expect, it } from "vitest";

import { ZOTERO_LOCALES } from "./date-formats.ts";
import { resolveZoteroLocale } from "./date-locale.ts";
import { strToMultipart } from "./multipart-date.ts";

const CURRENT_YEAR = 2026;
const EN_US = { currentYear: CURRENT_YEAR };

describe("strToMultipart, as the Zotero client stores a date field", () => {
  it.each([
    ["2021-05-13", "2021-05-13 2021-05-13"],
    ["2021/2026", "2021-00-00 2021/2026"],
    ["2021-05/2021-06", "2021-05-00 2021-05/2021-06"],
    ["2004-06~", "2004-06-00 2004-06~"],
    ["ca. 1900", "1900-00-00 ca. 1900"],
    ["429 CE", "0429-00-00 429 CE"],
    ["-500/-750", "0000-00-00 -500/-750"],
    ["500-750 BCE", "0000-00-00 500-750 BCE"],
    ["1996-1995", "1996-00-00 1996-1995"],
    ["-0429", "0000-00-00 -0429"],
    ["429 BCE", "0000-00-00 429 BCE"],
  ])(
    "gives %j the multipart value of Zotero's strToMultipart test",
    (value, multipart) => {
      expect(strToMultipart(value, EN_US)).toBe(multipart);
    },
  );

  it.each([
    ["2021-22", "2021-00-00 2021-22"],
    ["1995-05", "1995-05-00 1995-05"],
    ["1995–1996", "1995-00-00 1995–1996"],
    ["~1995", "1995-00-00 ~1995"],
    ["AD 429-500", "0429-00-00 AD 429-500"],
    ["2024-02-29", "2024-02-29 2024-02-29"],
  ])(
    "sorts %j by the start that Zotero's parseEDTF test gives",
    (value, multipart) => {
      expect(strToMultipart(value, EN_US)).toBe(multipart);
    },
  );

  it.each([
    ["June 26, 2010", "2010-06-26 June 26, 2010"],
    ["26 June 2010", "2010-06-26 26 June 2010"],
    ["001", "0001-00-00 001"],
    ["0012", "0012-00-00 0012"],
    ["0123", "0123-00-00 0123"],
    ["01/01/08", "2008-01-01 01/01/08"],
    ["1/1/68", "1968-01-01 1/1/68"],
    ["1/1/19", "2019-01-01 1/1/19"],
    ["8/2020", "2020-08-00 8/2020"],
    ["08/2020", "2020-08-00 08/2020"],
    ["1", "0000-01-00 1"],
    ["25", "0000-00-25 25"],
  ])(
    "reads %j as Zotero's strToDate test does in the en-US locale",
    (value, multipart) => {
      expect(strToMultipart(value, EN_US)).toBe(multipart);
    },
  );

  it.each([
    ["2021/11/05 05:49", "2021-11-05 2021/11/05 05:49"],
    ["November 2019", "2019-11-00 November 2019"],
    ["forthcoming", "0000-00-00 forthcoming"],
    ["Spring 2020", "2020-00-00 Spring 2020"],
    ["3rd March 2001", "2001-03-03 3rd March 2001"],
    ["März 2020", "2020-00-00 März 2020"],
  ])("gives %j a prefix the readers parse", (value, multipart) => {
    expect(strToMultipart(value, EN_US)).toBe(multipart);
  });

  it("places a two-digit year by the current year", () => {
    expect(strToMultipart("1/1/30", { currentYear: 2026 })).toBe(
      "1930-01-01 1/1/30",
    );
    expect(strToMultipart("1/1/30", { currentYear: 2031 })).toBe(
      "2030-01-01 1/1/30",
    );
  });

  it.each([
    ["en-US", "2020-01-02 01/02/2020"],
    ["en-PH", "2020-01-02 01/02/2020"],
    ["en-GB", "2020-02-01 01/02/2020"],
    ["de-DE", "2020-02-01 01/02/2020"],
    ["fr", "2020-02-01 01/02/2020"],
  ])(
    "reads the day and month of a slash date in the order of the client locale %s",
    (locale, multipart) => {
      expect(
        strToMultipart("01/02/2020", {
          currentYear: CURRENT_YEAR,
          locale: locale,
        }),
      ).toBe(multipart);
    },
  );

  it.each([
    ["fr-FR", "26 juin 2010", "2010-06-26 26 juin 2010"],
    ["fr", "26 juin 2010", "2010-06-26 26 juin 2010"],
    ["fr-ZZ", "26 juin 2010", "2010-06-26 26 juin 2010"],
    ["en-US", "26 juin 2010", "2010-00-26 26 juin 2010"],
    ["fr-FR", "26 June 2010", "2010-06-26 26 June 2010"],
    ["zh-CN", "\u56db\u6708 26, 2010", "2010-04-26 \u56db\u6708 26, 2010"],
    ["de", "M\u00e4rz 2020", "2020-03-00 M\u00e4rz 2020"],
    ["zz", "M\u00e4rz 2020", "2020-00-00 M\u00e4rz 2020"],
  ])(
    "reads the month names of the client locale %s and English, as Zotero's getMonths test does: %j",
    (locale, value, multipart) => {
      expect(strToMultipart(value, { currentYear: CURRENT_YEAR, locale })).toBe(
        multipart,
      );
    },
  );

  it("reads in the en-US locale when it is given no locale", () => {
    expect(strToMultipart("01/02/2020", { currentYear: CURRENT_YEAR })).toBe(
      "2020-01-02 01/02/2020",
    );
  });

  it("reads the day suffixes of the client locale", () => {
    expect(
      strToMultipart("June 3rd, 2020", {
        currentYear: CURRENT_YEAR,
        locale: "en-US",
      }),
    ).toBe("2020-06-03 June 3rd, 2020");
    expect(
      strToMultipart("June 3rd, 2020", {
        currentYear: CURRENT_YEAR,
        locale: "de",
      }),
    ).toBe("2020-06-00 June 3rd, 2020");
  });

  it("resolves a locale as the client resolves the requested locale", () => {
    expect(resolveZoteroLocale("pt")).toBe("pt-PT");
    expect(resolveZoteroLocale("zh")).toBe("zh-CN");
    expect(resolveZoteroLocale("en")).toBe("en-US");
    expect(resolveZoteroLocale("de-AT")).toBe("de");
    expect(resolveZoteroLocale("xx-YY")).toBe("en-US");
  });

  it.each(ZOTERO_LOCALES)(
    "builds the month and day patterns of the client locale %s; the el-GR list of the client puts May in the twelfth place",
    (locale) => {
      const resolved = { currentYear: CURRENT_YEAR, locale };
      expect(resolveZoteroLocale(locale)).toBe(locale);
      expect(strToMultipart("2020-05-17", resolved)).toBe(
        "2020-05-17 2020-05-17",
      );
      expect(strToMultipart("May 2020", resolved)).toBe(
        locale === "el-GR" ? "2020-12-00 May 2020" : "2020-05-00 May 2020",
      );
    },
  );

  it.each([
    ["en-AU", "en-AU", "2020-02-01 01/02/2020"],
    ["en-GB", "en-GB", "2020-02-01 01/02/2020"],
    ["en", "en-US", "2020-01-02 01/02/2020"],
    ["af-ZA", "en-US", "2020-01-02 01/02/2020"],
    ["xx-YY", "en-US", "2020-01-02 01/02/2020"],
  ])(
    "resolves %s among the locales that Zotero ships, as %s",
    (requested, resolved, multipart) => {
      expect(resolveZoteroLocale(requested)).toBe(resolved);
      expect(
        strToMultipart("01/02/2020", {
          currentYear: CURRENT_YEAR,
          locale: requested,
        }),
      ).toBe(multipart);
    },
  );

  it("counts a letter outside the Basic Multilingual Plane as a separator before a month, as the BMP letter class of the client does", () => {
    expect(
      strToMultipart("\u{20BB7}juin 2010", {
        currentYear: CURRENT_YEAR,
        locale: "fr-FR",
      }),
    ).toBe("2010-06-00 \u{20BB7}juin 2010");
  });

  it("puts the locale's day suffixes into the pattern unescaped, as the client does", () => {
    expect(
      strToMultipart("June 3x 2020", {
        currentYear: CURRENT_YEAR,
        locale: "de",
      }),
    ).toBe("2020-06-03 June 3x 2020");
    expect(
      strToMultipart("June 3x 2020", {
        currentYear: CURRENT_YEAR,
        locale: "en-US",
      }),
    ).toBe("2020-06-00 June 3x 2020");
  });
});
