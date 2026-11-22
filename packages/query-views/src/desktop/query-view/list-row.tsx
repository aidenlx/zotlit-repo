import type { ListMetrics, RowText } from "#core/query-view/list-heights.ts";
import { Fragment, useMemo, useState } from "react";

import type { DrawnEntry } from "./items-window.tsx";
import type { ListLayoutOptions } from "./list-layout.tsx";
import { RecordCell, holdsError } from "./record-rows.tsx";
import type { GroupEntry, RecordCells } from "./record-rows.tsx";
import type { PropertyEntry } from "./view-properties.ts";

import { sameMetrics, useRowHeights } from "#core/query-view/list-heights.ts";

const ROW = "data-query-row";
const LINES = "data-query-row-lines";

export interface ListRows {
  readonly properties: readonly PropertyEntry[];
  readonly options: ListLayoutOptions;
}

function shownCells({ cells, vault }: RecordCells): number[] {
  return cells.flatMap((text, cell) =>
    text === "" && vault[cell]?.note !== false ? [] : [cell],
  );
}

function rowLines(
  record: RecordCells,
  indentProperties: boolean,
): { first: number[]; rest: number[] } {
  const cells = shownCells(record);
  return indentProperties
    ? { first: cells.slice(0, 1), rest: cells.slice(1) }
    : { first: cells, rest: [] };
}

export function listRowText(
  record: RecordCells,
  { properties, options: { indentProperties, separator } }: ListRows,
): RowText | null {
  const { first, rest } = rowLines(record, indentProperties);
  for (const cell of [...first, ...rest])
    if (
      record.vault[cell] ||
      holdsError(record.row.values[properties[cell]!.path])
    )
      return null;
  const text = (cell: number) => record.cells[cell]!;
  return { first: first.map(text).join(separator), rest: rest.map(text) };
}

export function drawListRow(
  record: RecordCells,
  at: number,
  { properties, options: { markers, indentProperties, separator } }: ListRows,
): DrawnEntry {
  const { first, rest } = rowLines(record, indentProperties);
  const cell = (place: number) => (
    <RecordCell
      key={properties[place]!.path}
      record={record}
      properties={properties}
      at={place}
    />
  );
  const firstLine = first.map((place, part) => (
    <Fragment key={part}>
      {part > 0 && (
        <span className="zt:text-muted-foreground">{separator}</span>
      )}
      {cell(place)}
    </Fragment>
  ));
  return {
    props: {
      value: markers === "number" ? at + 1 : undefined,
      className: "zt:py-(--list-spacing)",
      [ROW]: record.row.indexedKey,
    },
    children: indentProperties ? (
      <>
        <span>{firstLine}</span>
        {rest.length > 0 && (
          <span
            className="zt:block zt:pl-(--list-indent) zt:text-muted-foreground"
            {...{ [LINES]: "" }}
          >
            {rest.map((place, line) => (
              <span key={line} className="zt:block">
                {cell(place)}
              </span>
            ))}
          </span>
        )}
      </>
    ) : (
      firstLine
    ),
  };
}

function readListMetrics(box: HTMLElement): ListMetrics | null {
  const row = box.querySelector<HTMLElement>(`li[${ROW}]`);
  if (!row) return null;
  const style = row.win.getComputedStyle(row);
  const lineHeight = Number.parseFloat(style.lineHeight);
  if (!Number.isFinite(lineHeight)) return null;
  const lines = box.querySelector<HTMLElement>(`[${LINES}]`);
  const indent = lines
    ? Number.parseFloat(lines.win.getComputedStyle(lines).paddingInlineStart)
    : 0;
  return {
    font: `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`,
    lineHeight,
    width:
      row.clientWidth -
      Number.parseFloat(style.paddingLeft) -
      Number.parseFloat(style.paddingRight),
    indent,
    padding:
      Number.parseFloat(style.paddingTop) +
      Number.parseFloat(style.paddingBottom),
  };
}

export function useListRowHeights(
  box: HTMLElement | null,
  entries: readonly GroupEntry[],
  { properties, options }: ListRows,
): {
  heights: readonly (number | null)[] | null;
  metrics: ListMetrics | null;
  read: () => void;
} {
  const { markers, indentProperties, separator } = options;
  const [metrics, setMetrics] = useState<ListMetrics | null>(null);
  const texts = useMemo(
    () =>
      entries.map((entry) =>
        entry.kind === "heading"
          ? null
          : listRowText(entry.record, {
              properties,
              options: { markers, indentProperties, separator },
            }),
      ),
    [entries, properties, markers, indentProperties, separator],
  );
  const heights = useRowHeights(texts, metrics, box?.doc ?? null);
  const read = () => {
    const drawn = box && readListMetrics(box);
    if (drawn && !sameMetrics(drawn, metrics)) setMetrics(drawn);
  };
  return { heights, metrics, read };
}
