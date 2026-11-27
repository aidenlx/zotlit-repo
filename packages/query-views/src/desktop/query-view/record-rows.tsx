import type {
  QueryViewRow,
  QueryViewValue,
} from "#worker/item-query/query-view.ts";
import { Fragment, useLayoutEffect, useMemo } from "react";

import {
  useAnnotStore,
  useToggleGroupCollapsed,
} from "@zotlit/annotations/obsidian/annot-view/store.ts";
import { errorCell, valueText } from "@zotlit/item-query";
import { Icon } from "@zotlit/obsidian-kit/components/obsidian/icon.tsx";
import { tooltipAttrs } from "@zotlit/obsidian-kit/utils.ts";

import { useQueryViewState } from "./model.ts";
import { NO_RESULTS } from "./results.ts";
import type { LiteratureNotes, VaultHost, VaultValue } from "./table-notes.ts";
import { cellText } from "./value-text.ts";
import { VaultCellContent, useVaultVersion, vaultText } from "./vault-cell.tsx";
import { useViewProperties } from "./view-properties.ts";
import type { PropertyEntry } from "./view-properties.ts";
import type { QueryView } from "./view.tsx";

import { vaultName } from "#core/query-view/query-file.ts";
import "./record-rows.css";

export interface ShownRecord {
  readonly row: QueryViewRow;
  readonly group?: { readonly key: string; readonly label: string };
}

export interface RecordGroup {
  readonly key: string | null;
  readonly label: string | null;
  readonly collapsed: boolean;
  readonly rows: readonly RecordCells[];
}

export type GroupEntry =
  | {
      readonly kind: "heading";
      readonly key: string;
      readonly group: RecordGroup;
    }
  | {
      readonly kind: "row";
      readonly key: string;
      readonly group: RecordGroup;
      readonly record: RecordCells;
      readonly at: number;
    };

export function groupEntries(groups: readonly RecordGroup[]): GroupEntry[] {
  const entries: GroupEntry[] = [];
  groups.forEach((group, groupIndex) => {
    const prefix = `${groupIndex}\n${group.key ?? ""}`;
    if (group.key !== null)
      entries.push({ kind: "heading", key: prefix, group });
    if (group.collapsed) return;
    group.rows.forEach((record, at) =>
      entries.push({
        kind: "row",
        key: `${prefix}\n${record.row.indexedKey}\n${at}`,
        group,
        record,
        at,
      }),
    );
  });
  return entries;
}

export interface RecordCells {
  readonly row: QueryViewRow;
  readonly cells: readonly string[];
  readonly vault: readonly (VaultValue | null)[];
}

export function recordCells(
  row: QueryViewRow,
  properties: readonly Pick<PropertyEntry, "path">[],
  {
    notes,
    host,
  }: { notes: Pick<LiteratureNotes, "read">; host: VaultHost | null },
): Pick<RecordCells, "cells" | "vault"> {
  const vault = properties.map(({ path }) => {
    const name = vaultName(path);
    return name === null ? null : notes.read(row.indexedKey, name, host);
  });
  const cells = properties.map(({ path }, at) => {
    const value = vault[at];
    return value ? vaultText(value) : cellText(path, row.values[path]);
  });
  return { cells, vault };
}

export function searchFinds(cells: readonly string[], query: string): boolean {
  return (
    query === "" || cells.some((text) => text.toLowerCase().includes(query))
  );
}

export function useRecordGroups(view: QueryView): {
  properties: readonly PropertyEntry[];
  groups: readonly RecordGroup[];
} {
  const columns = useViewProperties(view)?.visible;
  const records = useQueryViewState(
    view,
    (s) => (s.results ?? NO_RESULTS).records,
  );
  useLayoutEffect(() => view.drewRecords(records), [view, records]);
  const query = useAnnotStore((s) => s.filterQuery)
    .trim()
    .toLowerCase();
  const collapsed = useAnnotStore((s) => s.collapsedGroups);
  const { literatureNotes: notes } = view.tableDeps;
  const vaultVersion = useVaultVersion(notes);
  return useMemo(() => {
    void vaultVersion;
    const properties = columns ?? [];
    const host = view.vaultHost();
    const groups: {
      key: string | null;
      label: string | null;
      collapsed: boolean;
      rows: RecordCells[];
    }[] = [];
    for (const { row, group } of records) {
      const { cells, vault } = recordCells(row, properties, { notes, host });
      if (!searchFinds(cells, query)) continue;
      const key = group?.key ?? null;
      let last = groups.at(-1);
      if (!last || last.key !== key) {
        last = {
          key,
          label: group?.label ?? null,
          collapsed: key !== null && collapsed.has(key),
          rows: [],
        };
        groups.push(last);
      }
      last.rows.push({ row, cells, vault });
    }
    return { properties, groups };
  }, [columns, records, query, collapsed, notes, view, vaultVersion]);
}

export const HEADING_ESTIMATE = 38;

export function RecordGroupHeading({ group }: { group: RecordGroup }) {
  const toggle = useToggleGroupCollapsed();
  if (group.key === null) return null;
  const key = group.key;
  return (
    <div
      data-query-group={key}
      data-collapsed={group.collapsed ? "" : undefined}
      className="zt:mt-2 zt:first:mt-0"
    >
      <button
        type="button"
        aria-expanded={!group.collapsed}
        className="zt-query-group-toggle zt:flex zt:max-w-full zt:min-w-0 zt:cursor-(--cursor) zt:items-baseline zt:gap-(--size-4-1) zt:rounded-(--clickable-icon-radius) zt:px-(--size-2-2) zt:text-(length:--font-smaller) zt:leading-7.5 zt:font-(--font-semibold) zt:text-(--text-normal) zt:hover:bg-(--background-modifier-hover) zt:focus-visible:shadow-[0_0_0_var(--input-border-width-focus)_var(--background-modifier-border-focus)] zt:focus-visible:outline-none"
        onClick={() => toggle(key)}
      >
        <Icon
          name={group.collapsed ? "chevron-right" : "chevron-down"}
          size="xs"
          className="zt:shrink-0 zt:self-center zt:text-(--collapse-icon-color)"
        />
        <span className="zt:truncate">{group.label}</span>
      </button>
    </div>
  );
}

export function RecordCell({
  record: { row, cells, vault },
  properties,
  at,
}: {
  record: RecordCells;
  properties: readonly PropertyEntry[];
  at: number;
}) {
  const value = vault[at];
  if (value)
    return cells[at] === "" && value.note ? null : (
      <VaultCellContent value={value} />
    );
  return (
    <CellContent value={row.values[properties[at]!.path]} text={cells[at]!} />
  );
}

export function holdsError(value: QueryViewValue | undefined): boolean {
  return (
    errorCell(value) !== null ||
    (Array.isArray(value) && value.some((entry) => holdsError(entry)))
  );
}

export function CellContent({
  value,
  text,
}: {
  value: QueryViewValue | undefined;
  text: string;
}) {
  const error = errorCell(value);
  if (error !== null)
    return (
      <span
        role="img"
        className="zt:inline-flex zt:items-center zt:align-middle zt:text-(--text-error)"
        data-query-error={error.code}
        {...tooltipAttrs(error.message)}
      >
        <Icon name="alert-triangle" size="xs" />
      </span>
    );
  if (!Array.isArray(value) || !holdsError(value)) return text;
  const shown = value.filter(
    (entry: QueryViewValue) => valueText(entry) !== "",
  );
  return (
    <>
      {shown.map((entry: QueryViewValue, at) => (
        <Fragment key={at}>
          {at > 0 && ", "}
          <CellContent value={entry} text={valueText(entry)} />
        </Fragment>
      ))}
    </>
  );
}
