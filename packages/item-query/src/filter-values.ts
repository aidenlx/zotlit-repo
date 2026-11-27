import { compareStrings } from "./collation.ts";
import type {
  DateComparison,
  DateValue,
  DurationValue,
} from "./filter-dates.ts";
import { compareDates, dateText, durationsEqual } from "./filter-dates.ts";
import type { ErrorValue } from "./filter-error.ts";
import { errorValue, isError, renderEvaluationFault } from "./filter-error.ts";
import type { QueryClock } from "./query-clock.ts";

export type FilterValue =
  | null
  | boolean
  | number
  | string
  | readonly FilterValue[]
  | DateValue
  | DurationValue
  | RegexpValue
  | RecordValue
  | ErrorValue;

export interface RecordValue {
  readonly type: "record";
  readonly identity: string | object;
  readonly read: (name: string) => FilterValue;
}

export interface RegexpValue {
  readonly type: "regexp";
  readonly regexp: RegExp;
}

export type FilterValueType =
  | "null"
  | "boolean"
  | "number"
  | "string"
  | "list"
  | "date"
  | "duration"
  | "regexp"
  | "record"
  | "error";

export function typeOf(value: FilterValue): FilterValueType {
  if (value === null) return "null";
  if (isList(value)) return "list";
  if (typeof value === "object") return value.type;
  return typeof value as "boolean" | "number" | "string";
}

export function isQueryRecord(value: FilterValue): value is RecordValue {
  return typeOf(value) === "record";
}

export function isDate(value: FilterValue): value is DateValue {
  return typeOf(value) === "date";
}

export function isDuration(value: FilterValue): value is DurationValue {
  return typeOf(value) === "duration";
}

export function isList(value: FilterValue): value is readonly FilterValue[] {
  return Array.isArray(value);
}

export function isRegexp(value: FilterValue): value is RegexpValue {
  return typeOf(value) === "regexp";
}

export function truthy(value: FilterValue): boolean {
  if (value === null || isError(value)) return false;
  if (isList(value)) return value.length > 0;
  if (isDuration(value)) return !value.duration.blank;
  return Boolean(value);
}

export function equals(
  a: FilterValue,
  b: FilterValue,
  clock: QueryClock,
): boolean {
  if (isError(a) || isError(b)) return false;
  if (isQueryRecord(a)) return isQueryRecord(b) && a.identity === b.identity;
  if (isList(a)) {
    return (
      isList(b) &&
      a.length === b.length &&
      a.every((element, index) => equals(element, b[index]!, clock))
    );
  }
  if (isDate(a)) return isDate(b) && compareDates("==", [a, b], clock);
  if (isDuration(a)) return isDuration(b) && durationsEqual(a, b);
  if (isRegexp(a)) {
    return (
      isRegexp(b) &&
      a.regexp.source === b.regexp.source &&
      a.regexp.flags === b.regexp.flags
    );
  }
  return a === b;
}

export function compare(
  operator: Exclude<DateComparison, "==" | "!=">,
  [a, b]: readonly [FilterValue, FilterValue],
  clock: QueryClock,
): boolean | null | ErrorValue {
  if (isDate(a) && isDate(b)) return compareDates(operator, [a, b], clock);
  if (a === null || b === null) return null;
  const ordered = order(a, b);
  if (ordered === null) {
    return errorValue({
      code: "wrong-operand-type",
      operator,
      found: [typeOf(a), typeOf(b)],
    });
  }
  if (operator === "<") return ordered < 0;
  if (operator === "<=") return ordered <= 0;
  return operator === ">" ? ordered > 0 : ordered >= 0;
}

function order(a: FilterValue, b: FilterValue): number | null {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "string" && typeof b === "string") {
    return compareStrings(a, b);
  }
  return null;
}

export function errorValueText(message: string): string {
  return `Error: ${message}`;
}

export function toText(value: FilterValue): string {
  if (value === null) return "null";
  if (isError(value)) return errorValueText(renderEvaluationFault(value.fault));
  if (isList(value)) return value.map(toText).join(", ");
  if (isDate(value)) return dateText(value);
  if (isDuration(value)) return value.duration.toString();
  if (isRegexp(value)) return `/${value.regexp.source}/${value.regexp.flags}`;
  if (isQueryRecord(value)) return toText(value.read("indexedKey"));
  return String(value);
}
