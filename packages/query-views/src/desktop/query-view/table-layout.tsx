import type { ItemRowGestures } from "#core/query-view/item-rows.ts";
import type { ItemQueryError } from "#desktop/item-query/service.ts";
import type {
  QueryViewOutcome,
  QueryViewRequest,
  QueryViewRow,
  QueryViewValue,
} from "#worker/item-query/query-view.ts";
import { Effect, Schema } from "effect";
import { Keymap } from "obsidian";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { CSSProperties, ReactNode } from "react";

import type { TargetOpenGesture } from "@zotlit/annotations/desktop/attachment-open/actions.ts";
import { zoteroUri } from "@zotlit/annotations/desktop/attachment-open/open-target.ts";
import type { OpenTarget } from "@zotlit/annotations/desktop/attachment-open/open-target.ts";
import { useAnnotStore } from "@zotlit/annotations/obsidian/annot-view/store.ts";
import { isPageNumber } from "@zotlit/db";
import { iconButton } from "@zotlit/obsidian-kit/components/obsidian/icon-button.tsx";
import { Icon } from "@zotlit/obsidian-kit/components/obsidian/icon.tsx";
import { cn } from "@zotlit/obsidian-kit/utils.ts";
import type { ViewServices } from "@zotlit/obsidian-kit/view-atoms.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { parseIndexedKey } from "@zotlit/zotero-types/keys";
import { itemSelectUri } from "@zotlit/zotero-types/uri";

import { ItemsWindow } from "./items-window.tsx";
import type { DrawnEntry, WindowEntry } from "./items-window.tsx";
import type { QueryLayout } from "./layouts.ts";
import { useQueryTask, useQueryViewState } from "./model.ts";
import { CellContent, recordCells, searchFinds } from "./record-rows.tsx";
import { NO_RESULTS } from "./results.ts";
import { TableHeader } from "./table-header.tsx";
import type { LiteratureNotes, VaultHost } from "./table-notes.ts";
import { cellText } from "./value-text.ts";
import { VaultEditCell, useVaultVersion } from "./vault-cell.tsx";
import { useViewProperties } from "./view-properties.ts";
import type { PropertyEntry } from "./view-properties.ts";
import type { QueryView } from "./view.tsx";

import { useItemRow } from "#core/query-view/item-rows.ts";
import { LITERATURE_NOTE, vaultName } from "#core/query-view/query-file.ts";
import { ExpanderSpace } from "#obsidian/query-view/expander-space.tsx";

export const TABLE_LAYOUT: QueryLayout = {
  type: "table",
  datasets: ["items"],
  name: () => m.query_view_layout_table(),
  icon: "table",
};

export type TableRowKind = "item" | "attachment" | "annotation" | "note";

export interface TableRecord {
  readonly kind: TableRowKind;
  readonly key: string;
  readonly values: QueryViewRow["values"];
}

export interface ChildQuery {
  run(
    request: QueryViewRequest,
  ): Effect.Effect<QueryViewOutcome, ItemQueryError, ViewServices>;
}

export class ChildRowsUnread extends Schema.TaggedError<
  ChildRowsUnread,
  { readonly brand: unique symbol }
>()("ChildRowsUnread", {
  outcome: Schema.Literals(["failed", "cancelled"]),
}) {}

export interface TableChildSource {
  readonly parent: TableRowKind;
  readonly kind: TableRowKind;
  readonly icon: string;
  readonly marker: string;
  load(
    parent: TableRecord,
    query: ChildQuery,
  ): Effect.Effect<
    readonly TableRecord[],
    ItemQueryError | ChildRowsUnread,
    ViewServices
  >;
  render(record: TableRecord, row: ChildRowContext): ReactNode;
}

export interface ChildRowContext {
  readonly parent: TableRecord;
  readonly link: (target: OpenTarget, children: ReactNode) => ReactNode;
}

function text(value: QueryViewValue | undefined): string {
  return typeof value === "string" ? value : "";
}

function queried(
  kind: TableRowKind,
  request: (parentKey: string) => QueryViewRequest,
): TableChildSource["load"] {
  return (parent, query) =>
    Effect.gen(function* () {
      const outcome = yield* query.run(request(parent.key));
      if (outcome.kind !== "result")
        return yield* new ChildRowsUnread({ outcome: outcome.kind });
      const rows =
        outcome.result.rows ??
        outcome.result.groups.flatMap((group) => group.rows);
      return rows.map((row) => ({
        kind,
        key: row.indexedKey,
        values: row.values,
      }));
    });
}

export const TABLE_CHILD_SOURCES: readonly TableChildSource[] = [
  {
    parent: "item",
    kind: "attachment",
    icon: "paperclip",
    marker: "attachments[].indexedKey",
    load: queried("attachment", (itemKey) => ({
      from: "attachments",
      filter: `item.indexedKey == ${JSON.stringify(itemKey)}`,
      fields: ["title", ...markers("attachment")],
      limit: null,
    })),
    render: ({ key, values }, { link }) =>
      link(
        { kind: "attachment", attachmentKey: key },
        text(values.title) || key,
      ),
  },
  {
    parent: "item",
    kind: "note",
    icon: "sticky-note",
    marker: "notes",
    load: (parent) =>
      Effect.sync(() => {
        const notes = parent.values.notes;
        if (!Array.isArray(notes)) return [];
        return notes.flatMap((note: QueryViewValue): TableRecord[] => {
          if (note === null || typeof note !== "object" || Array.isArray(note))
            return [];
          const values = note as QueryViewRow["values"];
          return [{ kind: "note", key: text(values.indexedKey), values }];
        });
      }),
    render: ({ key, values }) => (
      <ZoteroNoteLink noteKey={key}>{text(values.title) || key}</ZoteroNoteLink>
    ),
  },
  {
    parent: "attachment",
    kind: "annotation",
    icon: "highlighter",
    marker: "annotations[].indexedKey",
    load: queried("annotation", (attachmentKey) => ({
      from: "annotations",
      filter: `attachment.indexedKey == ${JSON.stringify(attachmentKey)}`,
      fields: [
        "text",
        "comment",
        "color",
        "pageLabel",
        "pageIndex",
        ...markers("annotation"),
      ],
      sort: [{ field: "sortIndex", direction: "asc" }],
      limit: null,
    })),
    render: ({ key, values }, { parent, link }) => (
      <>
        <span
          className="zt:inline-block zt:size-2.5 zt:shrink-0 zt:rounded-full zt:bg-(--zt-annot-color)"
          style={
            {
              "--zt-annot-color": text(values.color) || undefined,
            } as CSSProperties
          }
        />
        {link(
          {
            kind: "annotation",
            attachmentKey: parent.key,
            annotationKey: key,
            pageIndex:
              typeof values.pageIndex === "number" ? values.pageIndex : null,
            pageLabel: text(values.pageLabel) || null,
          },
          <>
            <span className="zt:truncate">
              {text(values.text) || text(values.comment)}
            </span>
            {text(values.pageLabel) !== "" && (
              <span className="zt:shrink-0 zt:text-muted-foreground">
                {isPageNumber(text(values.pageLabel))
                  ? m.query_view_table_page({ page: text(values.pageLabel) })
                  : text(values.pageLabel)}
              </span>
            )}
          </>,
        )}
      </>
    ),
  },
];

export function markers(kind: TableRowKind): string[] {
  return TABLE_CHILD_SOURCES.filter((source) => source.parent === kind).map(
    (source) => source.marker,
  );
}

export const TABLE_FIELDS: readonly string[] = markers("item");

function markerKeys(value: QueryViewValue | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) =>
    entry !== null && typeof entry === "object" && !Array.isArray(entry)
      ? text(entry.indexedKey)
      : text(entry),
  );
}

function childSources(record: TableRecord) {
  return TABLE_CHILD_SOURCES.flatMap((source) => {
    if (source.parent !== record.kind) return [];
    const keys = markerKeys(record.values[source.marker]);
    return keys.length > 0 ? [{ source, keys }] : [];
  });
}

function expandable(record: TableRecord): boolean {
  return childSources(record).length > 0;
}

export const childSource = (kind: TableRowKind) =>
  TABLE_CHILD_SOURCES.find((source) => source.kind === kind)!;

export type PendingChild = Pick<TableRecord, "kind" | "key">;

export type ChildState =
  | { readonly phase: "loading"; readonly pending: readonly PendingChild[] }
  | { readonly phase: "ready"; readonly rows: readonly TableRecord[] }
  | { readonly phase: "failed" };

export const id = (record: Pick<TableRecord, "kind" | "key">) =>
  `${record.kind}:${record.key}`;

export const LOADING_TEXT =
  "zt:truncate zt:animate-in zt:fade-in zt:fill-mode-backwards zt:delay-150";

export function useChildren(view: QueryView) {
  const { query } = view.tableDeps;
  const [children, setChildren] = useState<ReadonlyMap<string, ChildState>>(
    () => new Map(),
  );
  const runs = useRef(new Map<string, () => void>());
  useEffect(() => {
    const open = runs.current;
    return () => {
      for (const stop of open.values()) stop();
      open.clear();
    };
  }, []);
  const set = (key: string, state: ChildState | null) =>
    setChildren((current) => {
      const next = new Map(current);
      if (state === null) next.delete(key);
      else next.set(key, state);
      return next;
    });
  const toggle = (record: TableRecord) => {
    const key = id(record);
    const running = runs.current.get(key);
    if (children.has(key)) {
      running?.();
      runs.current.delete(key);
      set(key, null);
      return;
    }
    const reads = childSources(record);
    if (reads.length === 0) {
      set(key, { phase: "ready", rows: [] });
      return;
    }
    set(key, {
      phase: "loading",
      pending: reads.flatMap(({ source, keys }) =>
        keys.map((childKey) => ({ kind: source.kind, key: childKey })),
      ),
    });
    const land = (state: ChildState) =>
      Effect.sync(() => {
        runs.current.delete(key);
        set(key, state);
      });
    runs.current.set(
      key,
      view.runTask(
        Effect.all(
          reads.map(({ source }) => source.load(record, query)),
          { concurrency: "unbounded" },
        ).pipe(
          Effect.matchEffect({
            onSuccess: (lists) => land({ phase: "ready", rows: lists.flat() }),
            onFailure: () => land({ phase: "failed" }),
          }),
        ),
      ),
    );
  };
  return { children, toggle };
}

export function Expander({
  record,
  open,
  onToggle,
  holdsMore = false,
}: {
  record: TableRecord;
  open: boolean;
  onToggle: () => void;
  holdsMore?: boolean;
}) {
  const chevron = (
    <Icon name={open ? "chevron-down" : "chevron-right"} size="xs" />
  );
  if (!holdsMore && !expandable(record)) return <ExpanderSpace />;
  return (
    <button
      type="button"
      className={iconButton({ className: "zt:shrink-0" })}
      aria-expanded={open}
      aria-label={
        open ? m.query_view_table_collapse() : m.query_view_table_expand()
      }
      data-query-expand={id(record)}
      onClick={onToggle}
    >
      {chevron}
    </button>
  );
}

function NoteCell({
  notes,
  itemKey,
}: {
  notes: LiteratureNotes;
  itemKey: string;
}) {
  const path = useSyncExternalStore(
    (listener) => notes.on("changed", listener),
    () => notes.find(itemKey)?.path ?? null,
  );
  const [creating, setCreating] = useState(false);
  const run = useQueryTask();
  const note = path === null ? null : notes.find(itemKey);
  if (note)
    return (
      <a
        className="internal-link"
        href={note.path}
        data-query-note={note.path}
        onClick={(event) => {
          event.preventDefault();
          run(notes.open(note, event.nativeEvent));
        }}
      >
        {note.basename}
      </a>
    );
  return (
    <button
      type="button"
      className={iconButton({ className: "zt:gap-1" })}
      disabled={creating}
      data-query-create-note={itemKey}
      onClick={() => {
        setCreating(true);
        run(
          notes
            .create(itemKey)
            .pipe(Effect.ensuring(Effect.sync(() => setCreating(false)))),
          () => m.notice_create_note_failed(),
        );
      }}
    >
      <Icon name="file-plus" size="xs" />
      {m.query_view_table_create_note()}
    </button>
  );
}

export function ZoteroNoteLink({
  noteKey,
  children,
}: {
  noteKey: string;
  children: ReactNode;
}) {
  const parsed = parseIndexedKey(noteKey);
  if (!parsed) return children;
  const uri = itemSelectUri(parsed.key, parsed.groupID);
  return (
    <a
      className="external-link zt:truncate zt:bg-none zt:pe-0"
      href={uri}
      data-query-open="note"
      onClick={(event) => {
        event.preventDefault();
        event.currentTarget.win.open(uri);
      }}
    >
      {children}
    </a>
  );
}

export function ReaderLink({
  readers,
  target,
  children,
}: {
  readers: TargetOpenGesture;
  target: OpenTarget;
  children: ReactNode;
}) {
  const open = (event: MouseEvent) => {
    event.preventDefault();
    readers.open(target, Keymap.isModEvent(event));
  };
  return (
    <a
      className="internal-link zt:flex zt:min-w-0 zt:items-center zt:gap-1.5"
      href={zoteroUri(target) ?? undefined}
      data-query-open={target.kind}
      onClick={(event) => open(event.nativeEvent)}
      onAuxClick={(event) => {
        if (event.button === 1) open(event.nativeEvent);
      }}
    >
      {children}
    </a>
  );
}

const indent = (depth: number) =>
  ({ "--zt-indent": `calc(${depth - 1} * var(--size-4-5))` }) as CSSProperties;

const CELL =
  "zt:h-(--bases-table-row-height) zt:border-b-(length:--border-width) zt:border-(--table-border-color) zt:px-2 zt:py-1 zt:whitespace-nowrap";
const GUTTER = cn(CELL, "zt:w-0 zt:py-0 zt:ps-1 zt:pe-0");
const FILLER = "zt:p-0";
const CLIP = "zt:max-w-0 zt:overflow-hidden zt:text-ellipsis";
const FIRST = cn("zt:ps-1", CLIP);
const FIRST_HEADER = cn(
  FIRST,
  "zt:[--zt-column-width:calc(var(--bases-table-column-max-width)*1px)]",
);
const LATER = cn("zt:border-s-(length:--border-width)", CLIP);
const LATER_HEADER = cn(
  LATER,
  "zt:[--zt-column-width:calc(var(--bases-table-column-max-width)*0.5px)]",
);
const LINE = "zt:block zt:w-0 zt:min-w-full zt:truncate";
const VAULT = "zt:relative zt:p-0 zt:overflow-visible";
const SPANNING = cn(CELL, CLIP);
const ROW = "zt:hover:bg-(--table-row-background-hover)";
const HEADER =
  "zt:sticky zt:top-0 zt:z-(--layer-cover) zt:bg-background zt:py-0 zt:font-(--font-weight) zt:whitespace-nowrap zt:text-muted-foreground zt:in-[.mod-sidedock]:bg-(--background-secondary) zt:in-[.callout]:bg-[image:linear-gradient(color-mix(in_oklch,var(--callout-color)_10%,transparent),color-mix(in_oklch,var(--callout-color)_10%,transparent))]";

const childSpan = (columns: number) => columns + 1;

function ChildRows({
  parent,
  depth,
  columns,
  expanded,
  toggle,
  readers,
}: {
  parent: TableRecord;
  depth: number;
  columns: number;
  expanded: ReadonlyMap<string, ChildState>;
  toggle: (record: TableRecord) => void;
  readers: TargetOpenGesture;
}) {
  const state = expanded.get(id(parent));
  if (!state) return null;
  if (state.phase === "loading")
    return state.pending.map((child, at) => (
      <tr key={id(child)} className={ROW} data-query-table-status="loading">
        <td className={GUTTER} />
        <td
          colSpan={childSpan(columns)}
          className={cn(SPANNING, "zt:ps-1 zt:text-(--text-muted)")}
        >
          <span
            className="zt:flex zt:min-w-0 zt:items-center zt:gap-1.5 zt:ps-(--zt-indent)"
            style={indent(depth)}
          >
            <ExpanderSpace />
            <Icon
              name={childSource(child.kind).icon}
              size="xs"
              className="zt:shrink-0"
            />
            {at === 0 && (
              <span className={LOADING_TEXT} data-query-loading="">
                {m.query_view_table_loading()}
              </span>
            )}
          </span>
        </td>
      </tr>
    ));
  if (state.phase === "failed")
    return (
      <tr data-query-table-status={state.phase}>
        <td className={GUTTER} />
        <td
          colSpan={childSpan(columns)}
          style={indent(depth)}
          className={cn(SPANNING, "zt:ps-(--zt-indent) zt:text-(--text-muted)")}
        >
          {m.query_view_table_children_failed()}
        </td>
      </tr>
    );
  return (
    <>
      {state.rows.map((record) => {
        const source = childSource(record.kind);
        return (
          <ChildRow
            key={id(record)}
            parent={parent}
            record={record}
            source={source}
            depth={depth}
            columns={columns}
            expanded={expanded}
            toggle={toggle}
            readers={readers}
          />
        );
      })}
    </>
  );
}

function ChildRow({
  parent,
  record,
  source,
  depth,
  columns,
  expanded,
  toggle,
  readers,
}: {
  parent: TableRecord;
  record: TableRecord;
  source: TableChildSource;
  depth: number;
  columns: number;
  expanded: ReadonlyMap<string, ChildState>;
  toggle: (record: TableRecord) => void;
  readers: TargetOpenGesture;
}) {
  const link: ChildRowContext["link"] = (target, children) => (
    <ReaderLink readers={readers} target={target}>
      {children}
    </ReaderLink>
  );
  return (
    <>
      <tr
        className={ROW}
        data-query-table-row={record.kind}
        data-query-key={record.key}
      >
        <td className={GUTTER} />
        <td colSpan={childSpan(columns)} className={cn(SPANNING, "zt:ps-1")}>
          <span
            className="zt:flex zt:min-w-0 zt:items-center zt:gap-1.5 zt:ps-(--zt-indent)"
            style={indent(depth)}
          >
            <Expander
              record={record}
              open={expanded.has(id(record))}
              onToggle={() => toggle(record)}
            />
            <Icon name={source.icon} size="xs" className="zt:shrink-0" />
            {source.render(record, { parent, link })}
          </span>
        </td>
      </tr>
      <ChildRows
        parent={record}
        depth={depth + 1}
        columns={columns}
        expanded={expanded}
        toggle={toggle}
        readers={readers}
      />
    </>
  );
}

export function TableLayout({ view }: { view: QueryView }) {
  const rows = useQueryViewState(
    view,
    (s) => (s.results ?? NO_RESULTS).records,
  );
  useLayoutEffect(() => view.drewRecords(rows), [view, rows]);
  const search = useAnnotStore((s) => s.filterQuery)
    .trim()
    .toLowerCase();
  const { literatureNotes, readers } = view.tableDeps;
  const { children: expanded, toggle } = useChildren(view);
  const properties = useViewProperties(view);
  const dataset = useQueryViewState(view, (s) => s.view?.from ?? "annotations");
  const columns = useMemo(() => properties?.visible ?? [], [properties]);
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  const sizes = useQueryViewState(view, (s) => s.view?.columnSize);
  const vaultVersion = useVaultVersion(literatureNotes);
  const visible = useMemo(() => {
    void vaultVersion;
    if (search === "") return rows;
    const host = view.vaultHost();
    return rows.filter(({ row }) =>
      searchFinds(
        recordCells(row, columns, { notes: literatureNotes, host }).cells,
        search,
      ),
    );
  }, [rows, columns, search, literatureNotes, view, vaultVersion]);
  const gestures = view.rows;
  const entries = useMemo(
    () =>
      visible.map(({ row, group }, index): WindowEntry => {
        const opens =
          group !== undefined &&
          group !== null &&
          group.key !== (visible[index - 1]?.group?.key ?? null);
        return {
          key: `${group?.key ?? ""}\0${row.indexedKey}\0${index}`,
          kind: opens ? "heading-row" : "row",
          item: row.indexedKey,
          own: expanded.has(id({ kind: "item", key: row.indexedKey })),
        };
      }),
    [visible, expanded],
  );
  if (rows.length === 0) return null;
  const span = childSpan(columns.length) + 1;
  const draw = (index: number): DrawnEntry => {
    const { row, group: placed } = visible[index]!;
    const record: TableRecord = {
      kind: "item",
      key: row.indexedKey,
      values: row.values,
    };
    const heading =
      placed && entries[index]!.kind === "heading-row" ? (
        <tr data-query-group={placed.key}>
          <th
            colSpan={span}
            className={cn(
              SPANNING,
              "zt:bg-card zt:text-start zt:font-(--font-semibold)",
            )}
          >
            {placed.label}
          </th>
        </tr>
      ) : null;
    return {
      children: (
        <ItemRow
          heading={heading}
          record={record}
          columns={columns}
          notes={literatureNotes}
          host={view.vaultHost()}
          expanded={expanded}
          toggle={toggle}
          readers={readers}
          gestures={gestures}
        />
      ),
    };
  };
  return (
    <ItemsWindow
      view={view}
      entries={entries}
      estimates={ESTIMATES}
      shape={JSON.stringify([columns.map(({ path }) => path), sizes ?? null])}
      box={{ className: "zt-table-scroller zt:relative" }}
      boxRef={setScroller}
      flow={{
        kind: "table",
        props: {
          className:
            "zt:min-w-full zt:border-separate zt:border-spacing-0 zt:text-(length:--bases-table-font-size)",
          "data-query-table": "",
        },
        head: properties && (
          <TableHeader
            view={view}
            properties={properties}
            dataset={dataset}
            scroller={scroller}
            sizes={sizes}
            classes={{
              gutter: cn(GUTTER, HEADER),
              cell: cn(CELL, HEADER),
              first: FIRST_HEADER,
              later: LATER_HEADER,
              filler: FILLER,
            }}
          />
        ),
        columns: columns.length,
      }}
      draw={draw}
    />
  );
}

const ESTIMATES = { row: 33, "heading-row": 66 };

function ItemRow({
  heading,
  record,
  columns,
  notes,
  host,
  expanded,
  toggle,
  readers,
  gestures,
}: {
  heading: ReactNode;
  record: TableRecord;
  columns: readonly PropertyEntry[];
  notes: LiteratureNotes;
  host: VaultHost | null;
  expanded: ReadonlyMap<string, ChildState>;
  toggle: (record: TableRecord) => void;
  readers: TargetOpenGesture;
  gestures: ItemRowGestures | undefined;
}) {
  const row = useItemRow(gestures, record.key);
  return (
    <>
      {heading}
      <tr
        {...row}
        className={cn(
          ROW,
          "zt:data-revealed:animate-row-flash zt:data-selected:bg-(--nav-item-background-selected)",
          "zt:outline-hidden zt:focus-visible:shadow-[inset_0_0_0_var(--input-border-width-focus)_var(--background-modifier-border-focus)]",
        )}
        data-query-table-row="item"
        data-query-key={record.key}
      >
        <td className={GUTTER}>
          <Expander
            record={record}
            open={expanded.has(id(record))}
            onToggle={() => toggle(record)}
          />
        </td>
        {columns.map(({ path }, at) => {
          const note = path === LITERATURE_NOTE;
          const name = note ? null : vaultName(path);
          return (
            <td
              key={path}
              className={cn(
                CELL,
                at === 0 ? FIRST : LATER,
                note && "zt:py-0",
                name !== null && VAULT,
              )}
            >
              {note ? (
                <span className={LINE}>
                  <NoteCell notes={notes} itemKey={record.key} />
                </span>
              ) : name !== null ? (
                <VaultEditCell
                  notes={notes}
                  itemKey={record.key}
                  name={name}
                  host={host}
                />
              ) : (
                <span className={LINE}>
                  <CellContent
                    value={record.values[path]}
                    text={cellText(path, record.values[path])}
                  />
                </span>
              )}
            </td>
          );
        })}
        <td
          aria-hidden="true"
          className={cn(CELL, FILLER)}
          data-query-table-filler=""
        />
      </tr>
      <ChildRows
        parent={record}
        depth={1}
        columns={columns.length}
        expanded={expanded}
        toggle={toggle}
        readers={readers}
      />
    </>
  );
}
