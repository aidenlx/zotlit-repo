import { regex } from "arkregex";

import { defineToString } from "./to-string.ts";

/** Full Y/M/D date parsed into a `Temporal.PlainDate`. */
export interface ItemDateYMD {
  /** Discriminator for the full-precision variant. */
  kind: "date";
  /** The parsed calendar date. */
  value: Temporal.PlainDate;
  /** Numeric year. */
  year: number;
  /** Month, 1-12. */
  month: number;
  /** Day of month. */
  day: number;
  /** The stored Zotero `date` value verbatim, retained for round-tripping. */
  raw: string;
  toString(): string;
}

/** Year and month only; `Temporal.PlainYearMonth` (no day). */
export interface ItemDateYearMonth {
  /** Discriminator for the year-and-month variant. */
  kind: "yearMonth";
  /** The parsed year and month. */
  value: Temporal.PlainYearMonth;
  /** Numeric year. */
  year: number;
  /** Month, 1-12. */
  month: number;
  /** Always `null` — this variant carries no day. */
  day: null;
  /** The stored Zotero `date` value verbatim, retained for round-tripping. */
  raw: string;
  toString(): string;
}

/**
 * Year only. Also covers Zotero's `01 2003` misparse where the user-string day
 * is meaningful but month is missing (the spurious day is dropped since no
 * `Temporal` type fits "year + day without month").
 */
export interface ItemDateYear {
  /** Discriminator for the year-only variant. */
  kind: "year";
  /** Always `null` — no `Temporal` type holds a bare year. */
  value: null;
  /** Numeric year. */
  year: number;
  /** Always `null` — the month is missing or unparseable. */
  month: null;
  /** Always `null` — this variant carries no day. */
  day: null;
  /** The stored Zotero `date` value verbatim, retained for round-tripping. */
  raw: string;
  toString(): string;
}

/** Unparseable / text-only: the year is missing or the SQL prefix is absent. */
export interface ItemDateText {
  /** Discriminator for the text variant. */
  kind: "text";
  /** Always `null` — nothing parsed, so there is no `Temporal` value. */
  value: null;
  /** The renderable user portion, or the entire raw value when non-multipart. */
  text: string;
  /**
   * Year extracted from {@link ItemDateText.text} when it holds a standalone
   * 4-digit year in the 1000-2999 range, else `null`.
   */
  year: number | null;
  /** Always `null` — the text variant resolves no month. */
  month: null;
  /** Always `null` — the text variant resolves no day. */
  day: null;
  /** The stored Zotero `date` value verbatim, retained for round-tripping. */
  raw: string;
  toString(): string;
}

export type ItemDate =
  | ItemDateYMD
  | ItemDateYearMonth
  | ItemDateYear
  | ItemDateText;

const MULTIPART_RE = regex(
  "^(?<year>[0-9]{4})-(?<month>0[0-9]|10|11|12)-(?<day>0[0-9]|[1-2][0-9]|30|31) (?<text>[\\s\\S]*)$",
);

const YEAR_RE = regex("\\b[12]\\d{3}\\b");

export function parseItemDate(raw: string | null | undefined): ItemDate | null {
  const date = parseItemDateInner(raw);
  return date && withToString(date);
}

export function withToString(date: ItemDate): ItemDate {
  return defineToString(date, function () {
    return formatItemDate(this);
  });
}

function parseItemDateInner(raw: string | null | undefined): ItemDate | null {
  if (!raw) return null;

  const match = MULTIPART_RE.exec(raw);
  if (!match) return textDate(raw, raw);

  const { year: yearStr, month: monthStr, day: dayStr, text } = match.groups;

  if (yearStr === "0000") return textDate(text, raw);

  const year = Number(yearStr);
  if (monthStr === "00") return yearOnly(year, raw);

  const month = Number(monthStr);
  if (dayStr === "00") {
    return tryYearMonth({ year, month }, raw) ?? yearOnly(year, raw);
  }

  const day = Number(dayStr);
  return (
    tryDate({ year, month, day }, raw) ??
    tryYearMonth({ year, month }, raw) ??
    yearOnly(year, raw)
  );
}

export function formatItemDate(date: ItemDate | null | undefined): string {
  if (!date) return "";
  switch (date.kind) {
    case "date":
    case "yearMonth":
      return date.value.toString();
    case "year":
      return String(date.year);
    case "text":
      return date.text;
  }
}

export function textDate(text: string, raw: string): ItemDateText {
  const match = YEAR_RE.exec(text);
  return {
    kind: "text",
    value: null,
    text,
    year: match ? Number(match[0]) : null,
    month: null,
    day: null,
    raw,
  };
}

export function yearOnly(year: number, raw: string): ItemDateYear {
  return { kind: "year", value: null, year, month: null, day: null, raw };
}

export function tryDate(
  parts: { year: number; month: number; day: number },
  raw: string,
): ItemDateYMD | null {
  try {
    const value = Temporal.PlainDate.from(parts, { overflow: "reject" });
    return {
      kind: "date",
      value,
      year: value.year,
      month: value.month,
      day: value.day,
      raw,
    };
  } catch {
    return null;
  }
}

export function tryYearMonth(
  parts: { year: number; month: number },
  raw: string,
): ItemDateYearMonth | null {
  try {
    const value = Temporal.PlainYearMonth.from(parts, { overflow: "reject" });
    return {
      kind: "yearMonth",
      value,
      year: value.year,
      month: value.month,
      day: null,
      raw,
    };
  } catch {
    return null;
  }
}
