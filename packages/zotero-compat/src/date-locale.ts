import { regex } from "arkregex";

import { DATE_FORMATS, DAY_SUFFIXES, ZOTERO_LOCALES } from "./date-formats.ts";

const DEFAULT_DATE_LOCALE = "en-US";

export interface DatePatterns {
  readonly country: string;
  readonly months: readonly string[];
  readonly monthRe: RegExp;
  readonly dayRe: RegExp;
}

export function resolveZoteroLocale(requested: string): string {
  if (ZOTERO_LOCALES.includes(requested)) return requested;
  const language = requested.slice(0, 2);
  if (ZOTERO_LOCALES.includes(language)) return language;
  const candidates = ZOTERO_LOCALES.filter(
    (locale) => locale.slice(0, 2) === language,
  );
  if (candidates.length === 0) return "en-US";
  candidates.sort((a, b) => {
    if (a === "en-US") return -1;
    if (b === "en-US") return 1;
    if (a.slice(0, 2) === a.slice(3, 5).toLowerCase()) return -1;
    if (b.slice(0, 2) === b.slice(3, 5).toLowerCase()) return 1;
    return a.slice(3, 5).localeCompare(b.slice(3, 5));
  });
  return candidates[0]!;
}

function monthNames(zoteroLocale: string): {
  short: readonly string[];
  long: readonly string[];
} {
  let locale = zoteroLocale;
  let english = locale.startsWith("en");
  if (!Object.hasOwn(DATE_FORMATS, locale)) locale = locale.slice(0, 2);
  if (!Object.hasOwn(DATE_FORMATS, locale)) {
    locale = `${locale}-${locale.toUpperCase()}`;
  }
  if (!Object.hasOwn(DATE_FORMATS, locale)) {
    const sameLanguage = Object.keys(DATE_FORMATS).filter((key) =>
      key.startsWith(locale.slice(0, 2)),
    );
    if (sameLanguage.length > 0) locale = sameLanguage[0]!;
  }
  if (!Object.hasOwn(DATE_FORMATS, locale)) {
    locale = "en-US";
    english = true;
  }
  const months = DATE_FORMATS[locale]!;
  if (english) return months;
  const englishMonths = DATE_FORMATS["en-US"]!;
  return {
    short: [...months.short, ...englishMonths.short],
    long: [...months.long, ...englishMonths.long],
  };
}

const cache = new Map<string, DatePatterns>();

export function datePatterns(requested = DEFAULT_DATE_LOCALE): DatePatterns {
  const locale = resolveZoteroLocale(requested);
  const known = cache.get(locale);
  if (known) return known;
  const names = monthNames(locale);
  const months = [...names.short, ...names.long].map((month) =>
    month.toLowerCase(),
  );
  const suffixes = (DAY_SUFFIXES[locale] ?? DAY_SUFFIXES["en-US"]!).replaceAll(
    /, ?/g,
    "|",
  );
  const result: DatePatterns = {
    country: locale.slice(3),
    months,
    monthRe: regex.as<
      string,
      { captures: [string, string, string | undefined] }
    >(
      `(.*)(?:^|[^\\p{L}]|[\\u{10000}-\\u{10FFFF}])(${months.join("|")})[^ ]*(?: (.*)$|$)`,
      "iu",
    ),
    dayRe: regex.as<string, { captures: [string, string] }>(
      `\\b([0-9]{1,2})(?:${suffixes})?\\b(.*)`,
      "i",
    ),
  };
  cache.set(locale, result);
  return result;
}
