import type {
  ColumnSizes,
  QueryFileDirection,
  QueryFileSort,
} from "./query-file.ts";

export function toggledSortDirection(
  sort: readonly QueryFileSort[],
  property: string,
): QueryFileDirection | null {
  const current = sort.find((entry) => entry.property === property);
  if (!current) return "ASC";
  return current.direction === "ASC" ? "DESC" : null;
}

export function headerSort(
  sort: readonly QueryFileSort[],
  property: string,
  direction: QueryFileDirection | null,
): QueryFileSort[] | undefined {
  const rest = sort.filter((entry) => entry.property !== property);
  const next = direction === null ? rest : [{ property, direction }, ...rest];
  return next.length > 0 ? next : undefined;
}

export function dropGap(
  widths: readonly number[],
  from: number,
  offset: number,
): number {
  let edge = 0;
  for (const [at, width] of widths.entries()) {
    if (offset < edge + (at <= from ? width : 0)) return at;
    edge += width;
  }
  return widths.length;
}

export function gapMove(from: number, gap: number): number | null {
  const to = gap > from ? gap - 1 : gap;
  return to === from ? null : to;
}

export function resizedWidth({
  start,
  delta,
  direction,
  min,
}: {
  start: number;
  delta: number;
  direction: "ltr" | "rtl";
  min: number;
}): number {
  return Math.max(
    min,
    Math.round(start + (direction === "rtl" ? -delta : delta)),
  );
}

export function withColumnWidth(
  sizes: ColumnSizes | undefined,
  property: string,
  width: number | null,
): ColumnSizes | undefined {
  const { [property]: _old, ...others } = sizes ?? {};
  const next = width === null ? others : { ...sizes, [property]: width };
  return Object.keys(next).length > 0 ? next : undefined;
}
