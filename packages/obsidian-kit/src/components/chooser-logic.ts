import { matchesSearchTerm } from "@zotlit/item-query";

interface ChooserRowBase {
  label: string;
  searchTerms?: readonly string[];
  disabled?: boolean;
}

export interface ChooserItemRow extends ChooserRowBase {
  value: string;
  action?: undefined;
  next?: (close: () => void) => void;
}

export interface ChooserActionRow extends ChooserRowBase {
  id: string;
  action: (close: () => void) => void;
  value?: undefined;
  next?: undefined;
}

export type ChooserRow = ChooserItemRow | ChooserActionRow;

export function chooserItemKey(value: string): string {
  return `item:${value}`;
}

export function chooserActionKey(id: string): string {
  return `action:${id}`;
}

export function chooserRowKey(row: ChooserRow): string {
  return row.action ? chooserActionKey(row.id) : chooserItemKey(row.value);
}

export interface ChooserGroup<Row extends ChooserRow> {
  label?: string;
  items: readonly Row[];
  pinned?: boolean;
}

export type ChooserMatcher = (text: string) => { score: number } | null;

export interface ChooserSection<Row extends ChooserRow> {
  label?: string;
  groupIndex: number;
  rows: Row[];
  pinned?: boolean;
}

export interface ChooserLayout<Row extends ChooserRow> {
  sections: ChooserSection<Row>[];
  rows: Row[];
  empty: boolean;
}

export function chooserLayout<Row extends ChooserRow>(
  groups: readonly ChooserGroup<Row>[],
  matcher: ChooserMatcher | null,
  query = "",
): ChooserLayout<Row> {
  const sections: ChooserSection<Row>[] = [];
  for (const [groupIndex, group] of groups.entries()) {
    const rows = group.items.filter(
      (row) =>
        row.action !== undefined ||
        matcher === null ||
        matcher(row.label) !== null ||
        row.searchTerms?.some((term) => matchesSearchTerm(term, query)),
    );
    if (rows.length > 0)
      sections.push({
        label: group.label,
        groupIndex,
        rows,
        ...(group.pinned && { pinned: true }),
      });
  }
  const rows = sections.flatMap((section) => section.rows);
  return {
    sections,
    rows,
    empty: rows.every((row) => row.action !== undefined),
  };
}

export function toggledValues(
  values: readonly string[],
  value: string,
): string[] {
  return values.includes(value)
    ? values.filter((current) => current !== value)
    : [...values, value];
}

export type ChooserActivation =
  | { kind: "ignored" }
  | { kind: "action"; run: (close: () => void) => void }
  | { kind: "select"; values: string[] };

export function activatedRow(
  row: ChooserRow | undefined,
  selected: readonly string[],
): ChooserActivation {
  if (!row || row.disabled) return { kind: "ignored" };
  if (row.action) return { kind: "action", run: row.action };
  return { kind: "select", values: toggledValues(selected, row.value) };
}

export type ChooserMove =
  | "previous"
  | "next"
  | "page-up"
  | "page-down"
  | "first"
  | "last";

export interface ChooserExtent {
  count: number;
  pageSize: number;
}

export function movedHighlight(
  index: number,
  move: ChooserMove,
  { count, pageSize }: ChooserExtent,
): number {
  if (count <= 0) return -1;
  const at = clampedHighlight(index, count);
  const last = count - 1;
  if (at < 0) return move === "previous" || move === "last" ? last : 0;
  const page = Math.max(1, pageSize);
  switch (move) {
    case "previous":
      return at === 0 ? last : at - 1;
    case "next":
      return at === last ? 0 : at + 1;
    case "page-up":
      return Math.max(0, at - page);
    case "page-down":
      return Math.min(last, at + page);
    case "first":
      return 0;
    case "last":
      return last;
  }
}

export function clampedHighlight(index: number, count: number): number {
  if (count <= 0 || index < 0) return -1;
  return Math.min(index, count - 1);
}

export function rehomedHighlight(
  rowKey: string | null,
  rows: readonly ChooserRow[],
): number {
  if (rows.length === 0 || rowKey === null) return -1;
  const at = rows.findIndex((row) => chooserRowKey(row) === rowKey);
  return at < 0 ? 0 : at;
}
