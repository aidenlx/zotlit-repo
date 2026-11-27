import type { QueryViewRow } from "#worker/item-query/query-view.ts";

import { delimited } from "@zotlit/shared/delimited";

import { cellText } from "./value-text.ts";
import type { PropertyEntry } from "./view-properties.ts";

export interface ResultTable {
  readonly header: readonly string[];
  readonly body: readonly (readonly string[])[];
}

export function resultTable(
  rows: readonly QueryViewRow[],
  columns: readonly Pick<PropertyEntry, "path" | "label">[],
  cell: (row: QueryViewRow, path: string) => string | undefined = () =>
    undefined,
): ResultTable {
  return {
    header: columns.map(({ label }) => label),
    body:
      columns.length === 0
        ? []
        : rows.map((row) =>
            columns.map(
              ({ path }) => cell(row, path) ?? cellText(path, row.values[path]),
            ),
          ),
  };
}

export function toCSV(table: ResultTable): string {
  return delimited([table.header, ...table.body], "csv");
}

export function toTSV(table: ResultTable): string {
  return delimited([table.header, ...table.body], "tsv").slice(0, -1);
}

function escapeHTML(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function toHTML(table: ResultTable): string {
  const cells = (line: readonly string[], tag: "th" | "td") =>
    line.map((text) => `<${tag}>${escapeHTML(text)}</${tag}>`).join("");
  return `<table><thead><tr>${cells(table.header, "th")}</tr></thead><tbody>${table.body
    .map((line) => `<tr>${cells(line, "td")}</tr>`)
    .join("")}</tbody></table>`;
}
