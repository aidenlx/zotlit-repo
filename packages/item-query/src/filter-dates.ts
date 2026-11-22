import { regex } from "arkregex";

import type { ItemDate } from "@zotlit/db";

import type { QueryClock } from "./query-clock.ts";

export type DatePrecision = "year" | "month" | "day";

export type DateValue =
  | {
      readonly type: "date";
      readonly precision: "instant";
      readonly instant: Temporal.Instant;
    }
  | {
      readonly type: "date";
      readonly precision: DatePrecision;
      readonly first: Temporal.PlainDate;
    };

export type CalendarDate = Extract<DateValue, { first: Temporal.PlainDate }>;

export interface DurationValue {
  readonly type: "duration";
  readonly duration: Temporal.Duration;
}

export function timestamp(instant: Temporal.Instant): DateValue {
  return { type: "date", precision: "instant", instant };
}

export function calendarDate(
  first: Temporal.PlainDate,
  precision: DatePrecision,
): CalendarDate {
  return { type: "date", precision, first };
}

export function today(clock: QueryClock): CalendarDate {
  return calendarDate(dayOf(clock.now, clock), "day");
}

export function dateOnly(date: DateValue, clock: QueryClock): CalendarDate {
  return date.precision === "instant"
    ? calendarDate(dayOf(date.instant, clock), "day")
    : date;
}

function dayOf(instant: Temporal.Instant, clock: QueryClock) {
  return instant.toZonedDateTimeISO(clock.timeZone).toPlainDate();
}

export function fromItemDate(date: ItemDate | null): CalendarDate | null {
  if (!date) return null;
  switch (date.kind) {
    case "date":
      return calendarDate(date.value, "day");
    case "yearMonth":
      return calendarDate(date.value.toPlainDate({ day: 1 }), "month");
    case "year":
      return yearDate(date.year);
    case "text":
      return date.year === null ? null : yearDate(date.year);
  }
}

function yearDate(year: number): CalendarDate {
  return calendarDate(
    Temporal.PlainDate.from({ year, month: 1, day: 1 }),
    "year",
  );
}

const SQL_DATE_TIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:[0-5]\d$/;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function fromAccessDate(raw: string | null): DateValue | null {
  if (raw === null) return null;
  try {
    if (SQL_DATE_TIME.test(raw)) {
      return timestamp(Temporal.Instant.from(`${raw.replace(" ", "T")}Z`));
    }
    if (ISO_DAY.test(raw)) {
      return calendarDate(Temporal.PlainDate.from(raw), "day");
    }
  } catch {
    // An impossible date, such as 2021-02-30.
  }
  return null;
}

const DATE_TIME = regex(
  "^\\d{4}-\\d{2}-\\d{2}[ T]\\d{2}:\\d{2}(?::\\d{2}(?:\\.\\d{1,9})?)?(?<offset>Z|[+-]\\d{2}(?::?\\d{2})?)?$",
);
const YEAR_MONTH = /^\d{4}-\d{2}$/;
const YEAR = /^\d{4}$/;
const COMPACT_DAY = regex(
  "^(?<year>\\d{4})(?<month>\\d{2})(?<day>\\d{2})(?:(?<hour>\\d{2})(?<minute>\\d{2}))?$",
);

export function parseDate(text: string, clock: QueryClock): DateValue | null {
  try {
    const dateTime = DATE_TIME.exec(text);
    if (dateTime) {
      const iso = text.replace(" ", "T");
      return timestamp(
        dateTime.groups.offset === undefined
          ? Temporal.PlainDateTime.from(iso, { overflow: "reject" })
              .toZonedDateTime(clock.timeZone)
              .toInstant()
          : Temporal.Instant.from(iso),
      );
    }
    if (ISO_DAY.test(text)) {
      return calendarDate(Temporal.PlainDate.from(text), "day");
    }
    if (YEAR_MONTH.test(text)) {
      return calendarDate(
        Temporal.PlainYearMonth.from(text).toPlainDate({ day: 1 }),
        "month",
      );
    }
    if (YEAR.test(text)) return yearDate(Number(text));
    const compact = COMPACT_DAY.exec(text);
    if (compact) {
      const { year, month, day, hour, minute } = compact.groups;
      const fields = {
        year: Number(year),
        month: Number(month),
        day: Number(day),
      };
      if (hour === undefined || minute === undefined) {
        return calendarDate(
          Temporal.PlainDate.from(fields, { overflow: "reject" }),
          "day",
        );
      }
      return timestamp(
        Temporal.PlainDateTime.from(
          { ...fields, hour: Number(hour), minute: Number(minute) },
          { overflow: "reject" },
        )
          .toZonedDateTime(clock.timeZone)
          .toInstant(),
      );
    }
  } catch {
    // An impossible date, such as 2020-13-01.
  }
  return null;
}

const DURATION_SHORTHAND = regex(
  "^(?<count>-?\\d+) ?(?<unit>[smhdwMy]|(?:second|minute|hour|day|week|month|year)s?)$",
);

export function parseDuration(text: string): DurationValue | null {
  const match = DURATION_SHORTHAND.exec(text);
  try {
    const duration = match
      ? Temporal.Duration.from({
          [shorthandUnit(match.groups.unit)]: Number(match.groups.count),
        })
      : Temporal.Duration.from(text);
    return { type: "duration", duration: foldWeeks(duration) };
  } catch {
    return null;
  }
}

function shorthandUnit(
  unit: string,
): "years" | "months" | "weeks" | "days" | "hours" | "minutes" | "seconds" {
  if (unit === "M" || unit.startsWith("month")) return "months";
  switch (unit[0]) {
    case "y":
      return "years";
    case "w":
      return "weeks";
    case "d":
      return "days";
    case "h":
      return "hours";
    case "s":
      return "seconds";
    default:
      return "minutes";
  }
}

function foldWeeks(duration: Temporal.Duration): Temporal.Duration {
  if (duration.weeks === 0) return duration;
  return duration.with({ weeks: 0, days: duration.days + duration.weeks * 7 });
}

function dayInterval(
  date: DateValue,
  clock: QueryClock,
): readonly [number, number] {
  const { first, precision } = dateOnly(date, clock);
  switch (precision) {
    case "year":
      return [
        dayKey(first.with({ month: 1, day: 1 })),
        dayKey(first.with({ month: 12, day: 31 })),
      ];
    case "month":
      return [
        dayKey(first.with({ day: 1 })),
        dayKey(first.with({ day: first.daysInMonth })),
      ];
    case "day":
      return [dayKey(first), dayKey(first)];
  }
}

export function dayKey(day: {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}): number {
  return day.year * 10_000 + day.month * 100 + day.day;
}

export type DateComparison = "==" | "!=" | "<" | "<=" | ">" | ">=";

export function compareDates(
  operator: DateComparison,
  [a, b]: readonly [DateValue, DateValue],
  clock: QueryClock,
): boolean {
  if (a.precision === "instant" && b.precision === "instant") {
    const order = Temporal.Instant.compare(a.instant, b.instant);
    switch (operator) {
      case "==":
        return order === 0;
      case "!=":
        return order !== 0;
      case "<":
        return order < 0;
      case "<=":
        return order <= 0;
      case ">":
        return order > 0;
      case ">=":
        return order >= 0;
    }
  }
  const [aFirst, aLast] = dayInterval(a, clock);
  const [bFirst, bLast] = dayInterval(b, clock);
  const overlap = aFirst <= bLast && bFirst <= aLast;
  switch (operator) {
    case "==":
      return overlap;
    case "!=":
      return !overlap;
    case "<":
      return aLast < bFirst;
    case "<=":
      return aFirst <= bLast;
    case ">":
      return aFirst > bLast;
    case ">=":
      return aLast >= bFirst;
  }
}

export function compareStarts(
  a: DateValue,
  b: DateValue,
  clock: QueryClock,
): number {
  return Temporal.Instant.compare(
    startOf(a, clock).toInstant(),
    startOf(b, clock).toInstant(),
  );
}

export function durationsEqual(a: DurationValue, b: DurationValue): boolean {
  return a.duration.toString() === b.duration.toString();
}

export function addDuration(
  date: DateValue,
  duration: Temporal.Duration,
  clock: QueryClock,
): DateValue | null {
  try {
    if (date.precision !== "instant" && !hasTimeOfDay(duration)) {
      return calendarDate(date.first.add(duration), date.precision);
    }
    return timestamp(startOf(date, clock).add(duration).toInstant());
  } catch {
    return null;
  }
}

function hasTimeOfDay(duration: Temporal.Duration): boolean {
  return (
    duration.hours !== 0 ||
    duration.minutes !== 0 ||
    duration.seconds !== 0 ||
    duration.milliseconds !== 0 ||
    duration.microseconds !== 0 ||
    duration.nanoseconds !== 0
  );
}

function startOf(date: DateValue, clock: QueryClock): Temporal.ZonedDateTime {
  return date.precision === "instant"
    ? date.instant.toZonedDateTimeISO(clock.timeZone)
    : date.first.toZonedDateTime(clock.timeZone);
}

export function datePart(
  date: DateValue,
  part:
    | "year"
    | "month"
    | "day"
    | "hour"
    | "minute"
    | "second"
    | "millisecond"
    | "timestamp",
  clock: QueryClock,
): number | null {
  if (part === "timestamp") return startOf(date, clock).epochMilliseconds;
  if (date.precision !== "instant") {
    switch (part) {
      case "year":
        return date.first.year;
      case "month":
        return date.precision === "year" ? null : date.first.month;
      case "day":
        return date.precision === "day" ? date.first.day : null;
      default:
        return 0;
    }
  }
  return startOf(date, clock)[part];
}

export function timeOfDay(date: DateValue, clock: QueryClock): string {
  return startOf(date, clock)
    .toPlainTime()
    .toString({ smallestUnit: "second" });
}

const FORMAT_TOKENS = /YYYY|MM|DD|HH|mm|ss/g;

export function formatDate(
  date: DateValue,
  pattern: string,
  clock: QueryClock,
): string {
  const start = startOf(date, clock);
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  return pattern.replaceAll(FORMAT_TOKENS, (token) => {
    switch (token) {
      case "YYYY":
        return pad(start.year, 4);
      case "MM":
        return pad(start.month);
      case "DD":
        return pad(start.day);
      case "HH":
        return pad(start.hour);
      case "mm":
        return pad(start.minute);
      default:
        return pad(start.second);
    }
  });
}

const DAY_MS = 86_400_000;
const INSTANT_UNITS = [
  ["year", 365 * DAY_MS],
  ["month", 30 * DAY_MS],
  ["day", DAY_MS],
  ["hour", 3_600_000],
  ["minute", 60_000],
] as const;

export function relativeDate(date: DateValue, clock: QueryClock): string {
  if (date.precision !== "instant") {
    const days = today(clock).first.until(date.first, {
      largestUnit: "day",
    }).days;
    if (days === 0) return "today";
    const size = Math.abs(days);
    const [unit, count] =
      size >= 365
        ? (["year", Math.round(size / 365)] as const)
        : size >= 30
          ? (["month", Math.round(size / 30)] as const)
          : (["day", size] as const);
    return words(unit, count, days < 0);
  }
  const difference =
    date.instant.epochMilliseconds - clock.now.epochMilliseconds;
  const size = Math.abs(difference);
  for (const [unit, unitMs] of INSTANT_UNITS) {
    if (size >= unitMs) {
      return words(unit, Math.round(size / unitMs), difference < 0);
    }
  }
  return "just now";
}

function words(unit: string, count: number, past: boolean): string {
  const label = `${count} ${unit}${count === 1 ? "" : "s"}`;
  return past ? `${label} ago` : `in ${label}`;
}

export function dateText(date: DateValue): string {
  switch (date.precision) {
    case "instant":
      return date.instant.toString();
    case "year":
      return String(date.first.year).padStart(4, "0");
    case "month":
      return date.first.toPlainYearMonth().toString();
    case "day":
      return date.first.toString();
  }
}
