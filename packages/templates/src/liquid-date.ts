interface ItemDateLike {
  kind: "date" | "yearMonth" | "year" | "text";
  year: number | null;
  month: number | null;
  day: number | null;
  toString(): string;
}

const ITEM_DATE_KINDS: ReadonlySet<unknown> = new Set([
  "date",
  "yearMonth",
  "year",
  "text",
] satisfies ItemDateLike["kind"][]);

export function isItemDateLike(value: unknown): value is ItemDateLike {
  return (
    typeof value === "object" &&
    value !== null &&
    ITEM_DATE_KINDS.has((value as { kind?: unknown }).kind)
  );
}

export function toLiquidDate(v: unknown): unknown {
  if (v instanceof Temporal.Instant) {
    return new Date(v.epochMilliseconds);
  }
  if (v instanceof Temporal.PlainDate) {
    return new Date(v.year, v.month - 1, v.day);
  }
  if (v instanceof Temporal.PlainYearMonth) {
    return new Date(v.year, v.month - 1, 1);
  }
  if (isItemDateLike(v)) {
    switch (v.kind) {
      case "date":
        return new Date(v.year!, v.month! - 1, v.day!);
      case "yearMonth":
        return new Date(v.year!, v.month! - 1, 1);
      case "year":
        return new Date(v.year!, 0, 1);
    }
  }
  return v;
}
