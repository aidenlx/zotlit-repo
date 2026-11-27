import { regex } from "arkregex";

import type { DatePatterns } from "./date-locale.ts";
import { datePatterns } from "./date-locale.ts";

const SLASH_RE = regex.as<
  string,
  {
    captures: [
      string,
      string,
      string | undefined,
      string | undefined,
      string | undefined,
      string | undefined,
      string,
    ];
  }
>(
  "^(.*?)\\b([0-9]{1,4})(?:([\\-\\/\\.\\u5e74])([0-9]{1,2}))?(?:([\\-\\/\\.\\u6708])([0-9]{1,4}))?((?:\\b|[^0-9]).*?)$",
);
const YEAR_RE = regex.as<string, { captures: [string, string, string] }>(
  "^(.*?)\\b((?:circa |around |about |c\\.? ?)?[0-9]{1,4}(?: ?B\\.? ?C\\.?(?: ?E\\.?)?| ?C\\.? ?E\\.?| ?A\\.? ?D\\.?)|[0-9]{3,4})\\b(.*?)$",
  "i",
);
interface DateParts {
  year?: number | string;
  month?: number;
  day?: number;
}

interface Part {
  part: string | undefined;
}

function trimInternal(value: string): string {
  return value.replaceAll(/[\xA0\r\n\s]+/g, " ").trim();
}

function strToDate(
  input: string,
  currentYear: number,
  locale: DatePatterns,
): DateParts {
  const string = trimInternal(input);
  if (!string) return {};

  let date: DateParts = {};
  const parts: Part[] = [];

  const m = SLASH_RE.exec(string);
  if (
    m &&
    (!m[5] || !m[3] || m[3] === m[5] || (m[3] === "年" && m[5] === "月")) &&
    ((m[2] && m[4] && m[6]) || (!m[1] && !m[7]))
  ) {
    let year: string | undefined;
    let month: string | undefined;
    let day: string | undefined;
    if (m[2].length === 3 || m[2].length === 4 || m[3] === "年") {
      [year, month, day] = [m[2], m[4], m[6]];
    } else if (m[2] && !m[4] && m[6]) {
      [month, year] = [m[2], m[6]];
    } else if (["US", "FM", "PW", "PH"].includes(locale.country)) {
      [month, day, year] = [m[2], m[4], m[6]];
    } else {
      [day, month, year] = [m[2], m[4], m[6]];
    }
    const longYear = !!year && year.length > 2;
    let y = year ? Number.parseInt(year, 10) : undefined;
    let d = day ? Number.parseInt(day, 10) : undefined;
    let mo = month ? Number.parseInt(month, 10) : undefined;
    if (mo && mo > 12) [d, mo] = [mo, d];

    if ((!mo || mo <= 12) && (!d || d <= 31)) {
      if (y && y < 100 && !longYear) {
        const twoDigitYear = currentYear % 100;
        const century = currentYear - twoDigitYear;
        y = y <= twoDigitYear ? century + y : century - 100 + y;
      }
      date = {};
      if (y) date.year = y;
      if (mo) date.month = mo - 1;
      if (d) date.day = d;
      parts.push({ part: m[1] }, { part: m[7] });
    } else {
      date = {};
      parts.push({ part: string });
    }
  } else {
    parts.push({ part: string });
  }

  if (!date.year) {
    for (const [i, { part }] of parts.entries()) {
      const found = YEAR_RE.exec(String(part));
      if (found) {
        date.year = found[2];
        parts.splice(i, 1, { part: found[1] }, { part: found[3] });
        break;
      }
    }
  }

  if (date.month === undefined) {
    for (const [i, { part }] of parts.entries()) {
      const found = locale.monthRe.exec(String(part));
      if (found) {
        date.month = locale.months.indexOf(found[2]!.toLowerCase()) % 12;
        parts.splice(i, 1, { part: found[1] }, { part: found[3] });
        break;
      }
    }
  }

  if (!date.day) {
    for (const [i, { part }] of parts.entries()) {
      const text = String(part);
      const found = locale.dayRe.exec(text);
      if (found) {
        const day = Number.parseInt(found[1]!, 10);
        if (day <= 31) {
          date.day = day;
          const rest =
            found.index > 0
              ? text.slice(0, found.index) + (found[2] ? ` ${found[2]}` : "")
              : found[2];
          parts.splice(i, 1, { part: rest });
          break;
        }
      }
    }
  }

  if (date.year !== undefined) date.year = `${date.year}`;
  return date;
}

const EDTF_SHAPE_RE = /^-?[0-9]{4}[-0-9~?%]*(\/-?[0-9]{4}[-0-9~?%]*)?$/;
const BCE_MARKER = "B\\.?\\s?C\\.?(?:\\s?E\\.?)?";
const CE_MARKER = "C\\.?\\s?E\\.?|A\\.?\\s?D\\.?";
const BCE_MARKER_RE = new RegExp(`^${BCE_MARKER}$`, "i");
const ERA_YEAR_RE = regex.as<
  string,
  { captures: [string | undefined, string, string | undefined] }
>(
  `^(?:(${CE_MARKER})\\s*)?([0-9]{1,4})(?:\\s*(${BCE_MARKER}|${CE_MARKER}))?$`,
  "i",
);
const ERA_RANGE_RE = regex.as<
  string,
  {
    captures: [
      string | undefined,
      string,
      string | undefined,
      string,
      string | undefined,
    ];
  }
>(
  `^(?:(${CE_MARKER})\\s*)?([0-9]{1,4})(?:\\s*(${BCE_MARKER}|${CE_MARKER}))?\\s*-\\s*([0-9]{1,4})(?:\\s*(${BCE_MARKER}|${CE_MARKER}))?$`,
  "i",
);
const ERA_MARKER_RE = new RegExp(
  `[0-9]\\s*(?:${BCE_MARKER}|${CE_MARKER})|(?:${CE_MARKER})\\s*[0-9]`,
  "i",
);
const NEGATIVE_YEAR_RE = /(?:^|\/)-[0-9]/;
const ERA_MARKERS_RE = new RegExp(`${BCE_MARKER}|${CE_MARKER}`, "gi");
const CIRCA_PREFIX_RE = /^(?:~|circa |ca\.? ?|c\. ?|about |around )\s*/i;
const EDTF_CHARS_RE = /^[-0-9T:+Z~?%/\s.]*$/i;
const YEAR_RANGE_RE = regex("^([0-9]{4})-([0-9]{2}|[0-9]{4})$");
const EDTF_DATE_RE = regex.as<
  string,
  {
    captures: [
      string,
      string | undefined,
      string | undefined,
      string | undefined,
    ];
  }
>("^(-?[0-9]{4})(?:-([0-9]{2})(?:-([0-9]{2}))?)?([~?%])?$");

function toEDTFYear(year: string, marker: string | undefined): string {
  return (
    (marker && BCE_MARKER_RE.test(marker) ? "-" : "") + year.padStart(4, "0")
  );
}

function eraToEDTF(value: string): string | false {
  const range = ERA_RANGE_RE.exec(value);
  const single = range ? null : ERA_YEAR_RE.exec(value);
  const match = range ?? single;
  if (!match) return false;
  const [, prefix, beginYear, beginMarkerRaw] = match;
  const endYear = range?.[4];
  const endMarker = range?.[5];
  if (prefix && beginMarkerRaw) return false;
  const beginMarker = prefix || beginMarkerRaw;
  if (!beginMarker && !endMarker) return false;
  if (/^0+$/.test(beginYear) || (endYear && /^0+$/.test(endYear))) return false;
  let edtf = toEDTFYear(beginYear, beginMarker || endMarker);
  if (endYear) edtf += `/${toEDTFYear(endYear, endMarker || beginMarker)}`;
  return edtf;
}

function normalizeDashes(value: string): string {
  return value.replaceAll(/[–—−]/g, "-").replaceAll(/--+/g, "-");
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function hasEraNotation(value: string): boolean {
  return (
    NEGATIVE_YEAR_RE.test(value) ||
    (ERA_MARKER_RE.test(value) &&
      EDTF_CHARS_RE.test(value.replaceAll(ERA_MARKERS_RE, "")))
  );
}

interface EdtfDate {
  year: number;
  month?: number;
  day?: number;
}

function parseEdtfDate(value: string): EdtfDate | false {
  const m = EDTF_DATE_RE.exec(value);
  if (!m) return false;
  const date: EdtfDate = { year: Number.parseInt(m[1], 10) };
  if (m[2]) {
    const month = Number.parseInt(m[2], 10);
    if (month < 1 || month > 12) return false;
    date.month = month - 1;
    if (m[3]) {
      const day = Number.parseInt(m[3], 10);
      if (day < 1 || day > daysInMonth(date.year, month)) return false;
      date.day = day;
    }
  }
  return date;
}

function parseEdtfBegin(input: string): EdtfDate | false {
  let value = normalizeDashes(input.trim());
  const circa = CIRCA_PREFIX_RE.test(value);
  if (circa) value = value.replace(CIRCA_PREFIX_RE, "");
  const era = eraToEDTF(value);
  if (era) value = era;
  if (!/^[-0-9]\S*$/.test(value)) return false;
  value = value.replaceAll(
    /(^|\/)-([0-9]{1,3})(?=[-~?%/]|$)/g,
    (_, pre: string, year: string) => `${pre}-${year.padStart(4, "0")}`,
  );
  const range = YEAR_RANGE_RE.exec(value);
  if (range) {
    const begin = Number.parseInt(range[1], 10);
    let end = Number.parseInt(range[2], 10);
    if (range[2].length === 2) {
      end = end > 12 ? Math.floor(begin / 100) * 100 + end : 0;
    }
    if (end > begin) value = `${range[1]}/${String(end).padStart(4, "0")}`;
  }
  if (circa && !/[~?%]$/.test(value)) value += "~";
  if (!EDTF_SHAPE_RE.test(value)) return false;

  const [beginText = "", endText] = value.split("/");
  const begin = parseEdtfDate(beginText);
  if (!begin) return false;
  if (endText !== undefined) {
    const end = parseEdtfDate(endText);
    if (!end) return false;
    const comparable = (date: EdtfDate) =>
      date.year * 10000 +
      (date.month !== undefined ? (date.month + 1) * 100 : 0) +
      (date.day ?? 0);
    if (comparable(end) <= comparable(begin)) return false;
  }
  return begin;
}

export interface MultipartContext {
  readonly currentYear: number;
  readonly locale?: string | undefined;
}

export function strToMultipart(
  value: string,
  { currentYear, locale }: MultipartContext,
): string {
  if (!value) return "";
  let parts: DateParts;
  const edtf = parseEdtfBegin(value);
  if (edtf) parts = edtf;
  else if (
    hasEraNotation(normalizeDashes(value.trim()).replace(CIRCA_PREFIX_RE, ""))
  )
    parts = {};
  else parts = strToDate(value, currentYear, datePatterns(locale));

  let year = parts.year === undefined ? "" : `${parts.year}`;
  if (!/^[0-9]{1,4}$/.test(year)) year = "";
  const month = parts.month === undefined ? "" : `${parts.month + 1}`;
  const day = parts.day ? `${parts.day}` : "";
  return `${year ? year.padStart(4, "0") : "0000"}-${month.padStart(2, "0")}-${day.padStart(2, "0")} ${value}`;
}
