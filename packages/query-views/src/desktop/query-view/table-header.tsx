import type {
  ColumnSizes,
  QueryFileDataset,
  QueryFileDirection,
} from "#core/query-view/query-file.ts";
import { Menu, Platform } from "obsidian";
import { useEffect, useRef } from "react";
import type { CSSProperties, DragEvent, MouseEvent, PointerEvent } from "react";

import { useObsidianApp } from "@zotlit/obsidian-kit/app-context.ts";
import { Icon } from "@zotlit/obsidian-kit/components/obsidian/icon.tsx";
import { pointerDrag } from "@zotlit/obsidian-kit/pointer-drag.ts";
import { cn, tooltipAttrs } from "@zotlit/obsidian-kit/utils.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import { columnMenuEntries } from "./column-menu.ts";
import type { ColumnMenuAction } from "./column-menu.ts";
import { ColumnPropertyPopover } from "./column-property-popover.tsx";
import type { ColumnPropertyHandle } from "./column-property-popover.tsx";
import { useQueryViewState } from "./model.ts";
import { groupOptions } from "./properties.ts";
import { propertyIcon } from "./property-icon.ts";
import { useVaultPropertyNames, useVaultVersion } from "./vault-cell.tsx";
import { viewSortOptions } from "./vault-sort.ts";
import { viewProperties } from "./view-properties.ts";
import type { ViewProperties } from "./view-properties.ts";
import type { QueryView } from "./view.tsx";
import "./table-header.css";

import {
  dropGap,
  gapMove,
  headerSort,
  toggledSortDirection,
  resizedWidth,
  withColumnWidth,
} from "#core/query-view/table-columns.ts";
import { ExpanderSpace } from "#obsidian/query-view/expander-space.tsx";
import { moved } from "#obsidian/query-view/reorder.tsx";

export interface HeaderClasses {
  readonly gutter: string;
  readonly cell: string;
  readonly first: string;
  readonly later: string;
  readonly filler: string;
}

const BLANK =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs=";

function startDrag(event: DragEvent<HTMLElement>): void {
  const doc = event.currentTarget.doc;
  const transfer = event.dataTransfer;
  transfer.effectAllowed = "move";
  transfer.setData("text/plain", "");
  const image = doc.win.createEl("img");
  image.src = BLANK;
  doc.body.append(image);
  transfer.setDragImage(image, 0, 0);
  doc.win.setTimeout(() => image.remove(), 0);
  doc.body.classList.add("is-grabbing");
}

interface DragHandlers {
  // oxlint-disable-next-line obsidianmd/no-global-this -- type position: React's event type shadows the DOM name
  over: (event: globalThis.DragEvent) => boolean;
  // oxlint-disable-next-line obsidianmd/no-global-this -- type position: React's event type shadows the DOM name
  drop: (event: globalThis.DragEvent) => boolean;
  done: (dropped: boolean) => void;
}

function followDrag(
  source: HTMLElement,
  controller: AbortController,
  handlers: DragHandlers,
): void {
  const { doc, win } = source;
  const { signal } = controller;
  const options = { capture: true, signal };
  let dropped = false;
  signal.addEventListener(
    "abort",
    () => {
      doc.body.classList.remove("is-grabbing");
      handlers.done(dropped);
    },
    { once: true },
  );
  // oxlint-disable-next-line obsidianmd/no-global-this -- type position: React's event type shadows the DOM name
  const over = (event: globalThis.DragEvent) => {
    if (!handlers.over(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  };
  win.addEventListener("dragover", over, options);
  win.addEventListener("dragenter", over, options);
  win.addEventListener(
    "drop",
    (event) => {
      dropped = handlers.drop(event);
      controller.abort();
    },
    options,
  );
  const end = () => controller.abort();
  source.addEventListener("dragend", end, { signal });
  win.addEventListener("dragend", end, options);
}

const SORT_DIRECTION = {
  "sort-asc": "ASC",
  "sort-desc": "DESC",
  "clear-sort": null,
} as const satisfies Partial<
  Record<ColumnMenuAction, QueryFileDirection | null>
>;

const ENTRY: Record<ColumnMenuAction, { title: () => string; icon: string }> = {
  hide: { title: m.query_view_table_hide_column, icon: "lucide-eye-off" },
  group: { title: m.query_view_table_group_by, icon: "lucide-layout-list" },
  "move-left": {
    title: m.query_view_table_move_column_left,
    icon: "lucide-arrow-left",
  },
  "move-right": {
    title: m.query_view_table_move_column_right,
    icon: "lucide-arrow-right",
  },
  "reset-width": {
    title: m.query_view_table_reset_column_width,
    icon: "lucide-rotate-ccw",
  },
  "sort-asc": {
    title: m.query_view_table_sort_az,
    icon: "lucide-arrow-down-wide-narrow",
  },
  "sort-desc": {
    title: m.query_view_table_sort_za,
    icon: "lucide-arrow-up-narrow-wide",
  },
  "clear-sort": {
    title: m.query_view_table_clear_sort,
    icon: "lucide-eraser",
  },
  "edit-property": {
    title: m.query_view_table_edit_property,
    icon: "lucide-pencil",
  },
  "edit-formula": {
    title: m.query_view_table_edit_formula,
    icon: "lucide-pencil",
  },
};

function swallowClick(win: Window): void {
  // oxlint-disable-next-line obsidianmd/no-global-this -- type position: React's event type shadows the DOM name
  const swallow = (click: globalThis.MouseEvent) => {
    click.preventDefault();
    click.stopPropagation();
  };
  win.addEventListener("click", swallow, { capture: true, once: true });
  win.setTimeout(
    () => win.removeEventListener("click", swallow, { capture: true }),
    0,
  );
}

function minColumnWidth(el: HTMLElement): number {
  return Number.parseFloat(
    el.win
      .getComputedStyle(el)
      .getPropertyValue("--bases-table-column-min-width"),
  );
}

const isRTL = (el: HTMLElement) =>
  el.win.getComputedStyle(el).direction === "rtl";

const SIZED =
  "zt:w-(--zt-column-width) zt:min-w-(--zt-column-width) zt:max-w-(--zt-column-width)";

const COLUMN_WIDTH = "--zt-column-width";

const widthStyle = (width: number) =>
  ({ [COLUMN_WIDTH]: `${width}px` }) as CSSProperties;

function markSized(th: HTMLTableCellElement, sized: boolean): void {
  if (sized) th.dataset.sized = "";
  else delete th.dataset.sized;
}

const sizedMark = (
  sizes: ColumnSizes | undefined,
  path: string,
): "" | undefined => (sizes?.[path] === undefined ? undefined : "");

function showWidth(th: HTMLTableCellElement, width: number): void {
  markSized(th, true);
  th.style.setProperty(COLUMN_WIDTH, `${width}px`);
}

const LABEL = "zt:flex zt:w-0 zt:min-w-full zt:items-center zt:gap-1";

const DROP_LINE =
  "table-drag-target mod-col zt-column-drop-line zt:start-(--zt-drop-x) zt:top-(--zt-drop-top) zt:h-(--zt-drop-height) zt:transition-all zt:duration-75 zt:ease-in";

export function TableHeader({
  view,
  properties,
  dataset,
  scroller,
  classes,
  sizes,
}: {
  view: QueryView;
  properties: ViewProperties;
  dataset: QueryFileDataset;
  scroller: HTMLElement | null;
  classes: HeaderClasses;
  sizes: ColumnSizes | undefined;
}) {
  const app = useObsidianApp();
  const columns = properties.visible;
  const editable = view.canSave;
  const resizable = editable && view.can.columnWidth;
  const { literatureNotes } = view.tableDeps;
  useVaultVersion(literatureNotes);
  const vaultNames = useVaultPropertyNames(literatureNotes);
  const ranked = useQueryViewState(view, (s) => s.results?.ranked ?? false);
  const sort = useQueryViewState(view, (s) => s.view?.sort);
  const sortable = (path: string): boolean =>
    !ranked &&
    viewSortOptions(view.state.getState().view?.from, vaultNames, {
      labelOf: (named) => named,
      typeOf: (name) => literatureNotes.propertyType(name),
    }).some((option) => option.path === path);
  const editor = useRef<ColumnPropertyHandle>(null);
  const drag = useRef<AbortController | null>(null);
  useEffect(() => () => drag.current?.abort(), []);
  const begin = (): AbortController => {
    drag.current?.abort();
    const controller = new AbortController();
    drag.current = controller;
    return controller;
  };

  const headerCells = (row: Element) => [
    ...row.querySelectorAll<HTMLElement>(":scope > th[data-query-column]"),
  ];

  const moveColumn = (event: DragEvent<HTMLElement>, path: string) => {
    const th = event.currentTarget;
    const row = th.parentElement!;
    const box = scroller;
    const table = th.closest("table");
    if (!box || !table) return;
    const controller = begin();
    startDrag(event);
    const line = th.doc.win.createDiv();
    line.className = DROP_LINE;
    th.dataset.dragging = "";
    const place = (clientX: number) => {
      const cells = headerCells(row);
      const from = cells.findIndex((cell) => cell.dataset.queryColumn === path);
      const first = cells[0];
      if (from < 0 || !first) return null;
      const rtl = isRTL(row);
      const start = first.getBoundingClientRect();
      const widths = cells.map((cell) => cell.getBoundingClientRect().width);
      const gap = dropGap(
        widths,
        from,
        rtl ? start.right - clientX : clientX - start.left,
      );
      const run = widths.slice(0, gap).reduce((sum, w) => sum + w, 0);
      return {
        paths: cells.map((cell) => cell.dataset.queryColumn!),
        from,
        gap,
        edge: rtl ? start.right - run : start.left + run,
        rtl,
      };
    };
    followDrag(th, controller, {
      over: (over) => {
        const at = table.contains(over.targetNode) ? place(over.clientX) : null;
        if (!at) {
          line.remove();
          return false;
        }
        const frame = box.getBoundingClientRect();
        const x = at.rtl
          ? frame.right - box.clientLeft - at.edge - box.scrollLeft
          : at.edge - frame.left - box.clientLeft + box.scrollLeft;
        if (!line.isConnected) box.append(line);
        line.style.setProperty("--zt-drop-x", `${x}px`);
        line.style.setProperty("--zt-drop-top", `${box.scrollTop}px`);
        line.style.setProperty("--zt-drop-height", `${box.clientHeight}px`);
        return true;
      },
      drop: (drop) => {
        if (!table.contains(drop.targetNode)) return false;
        drop.preventDefault();
        const at = place(drop.clientX);
        const { file, view: shown } = view.state.getState();
        if (!at || !shown) return true;
        const current = viewProperties(file, shown);
        const order = current.visible.map((entry) => entry.path);
        if (order.join("\0") !== at.paths.join("\0")) return true;
        const to = gapMove(at.from, at.gap);
        if (to !== null)
          view.document.editView({
            order: current.orderOf(moved(order, at.from, to)),
          });
        return true;
      },
      done: () => {
        line.remove();
        delete th.dataset.dragging;
      },
    });
  };

  const resizeColumn = (event: PointerEvent<HTMLElement>, path: string) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    const th = handle.closest("th")!;
    const before = {
      sized: th.dataset.sized,
      width: th.style.getPropertyValue(COLUMN_WIDTH),
    };
    const start = th.getBoundingClientRect().width;
    const min = minColumnWidth(th);
    const direction = isRTL(th) ? "rtl" : "ltr";
    const widthAt = (delta: number) =>
      resizedWidth({ start, delta, direction, min });
    let saved = false;
    pointerDrag({
      app,
      press: event,
      handle,
      cursor: RESIZING,
      controller: begin(),
      move: (delta) => showWidth(th, widthAt(delta)),
      drop: (delta) => {
        const width = widthAt(delta);
        saved = true;
        swallowClick(th.win);
        showWidth(th, width);
        const current = view.state.getState().view?.columnSize;
        if (current?.[path] !== width)
          view.document.editView({
            columnSize: withColumnWidth(current, path, width),
          });
      },
      end: () => {
        if (saved) return;
        if (before.sized === undefined) markSized(th, false);
        th.style.setProperty(COLUMN_WIDTH, before.width);
      },
    });
  };

  const resetColumn = (path: string) => {
    if (sizes?.[path] === undefined) return;
    view.document.editView({
      columnSize: withColumnWidth(sizes, path, null),
    });
  };

  const stepColumn = (path: string, step: -1 | 1) => {
    const { file, view: shown } = view.state.getState();
    if (!shown) return;
    const current = viewProperties(file, shown);
    const order = current.visible.map((entry) => entry.path);
    const from = order.indexOf(path);
    const to = from + step;
    if (from < 0 || to < 0 || to >= order.length) return;
    view.document.editView({ order: current.orderOf(moved(order, from, to)) });
  };

  const columnMenu = (event: MouseEvent<HTMLElement>, path: string) => {
    event.preventDefault();
    const th = event.currentTarget;
    editor.current?.close();
    const rtl = isRTL(th);
    const { view: shown } = view.state.getState();
    const dataset = shown?.from;
    const at = columns.findIndex((entry) => entry.path === path);
    const grouping =
      groupOptions(dataset).find(
        (option) => option.path.replace(/\[\]$/, "") === path,
      )?.path ?? null;
    const entries = columnMenuEntries({
      path,
      kind: columns[at]?.kind ?? "field",
      at,
      count: columns.length,
      rtl,
      sized: sizes?.[path] !== undefined,
      can: view.can,
      sortable: sortable(path),
      sort: shown?.sort ?? [],
      groupBy: shown?.groupBy,
      grouping,
    });

    const run = (action: ColumnMenuAction) => {
      const { file, view: now } = view.state.getState();
      if (!now) return;
      switch (action) {
        case "hide":
          view.document.editView({
            order: viewProperties(file, now).withShown(path, false),
          });
          return;
        case "group":
          if (grouping !== null && now.groupBy?.property !== grouping)
            view.document.editView({
              groupBy: { property: grouping, direction: "ASC" },
              groupOrder: undefined,
            });
          return;
        case "move-left":
          stepColumn(path, rtl ? 1 : -1);
          return;
        case "move-right":
          stepColumn(path, rtl ? -1 : 1);
          return;
        case "reset-width":
          resetColumn(path);
          return;
        case "sort-asc":
        case "sort-desc":
        case "clear-sort":
          view.document.editView({
            sort: headerSort(now.sort ?? [], path, SORT_DIRECTION[action]),
          });
          return;
        case "edit-property":
        case "edit-formula":
          editor.current?.open(th, path);
          return;
        default:
          action satisfies never;
      }
    };

    const menu = new Menu();
    for (const [index, group] of entries.entries()) {
      if (index > 0) menu.addSeparator();
      for (const { action, disabled, checked } of group)
        menu.addItem((item) => {
          item
            .setTitle(ENTRY[action].title())
            .setIcon(ENTRY[action].icon)
            .onClick(() => run(action));
          if (disabled) item.setDisabled(true);
          if (checked !== undefined) item.setChecked(checked);
          if (action === "clear-sort") item.setWarning(true);
        });
    }
    menu.setParentElement(th).showAtMouseEvent(event.nativeEvent);
  };

  const toggleSort = (event: MouseEvent<HTMLElement>, path: string) => {
    if (event.defaultPrevented || event.button !== 0) return;
    event.preventDefault();
    const now = view.state.getState().view;
    if (!now || !sortable(path)) return;
    const current = now.sort ?? [];
    view.document.editView({
      sort: headerSort(current, path, toggledSortDirection(current, path)),
    });
  };

  const { gutter, cell, first, later, filler } = classes;
  return (
    <tr className="zt:text-start">
      <th className={gutter}>
        <ExpanderSpace />
        {editable && view.can.propertyPages && (
          <ColumnPropertyPopover
            view={view}
            properties={properties}
            handle={editor}
          />
        )}
      </th>
      {columns.map((property, at) => {
        const width = sizes?.[property.path];
        const icon = propertyIcon(dataset, property, (name) =>
          literatureNotes.propertyType(name),
        );
        const sorted = ranked
          ? undefined
          : sort?.find((entry) => entry.property === property.path);
        const label = cn(LABEL, sorted && SORTED_LABEL);
        const name = (
          <span className={cn("zt:truncate", sorted && SORTED_NAME)}>
            {property.label}
          </span>
        );
        return (
          <th
            key={property.path}
            className={cn(
              "zt:group/column",
              cell,
              at === 0 ? first : later,
              SIZED,
              editable && MOVABLE,
            )}
            style={width === undefined ? undefined : widthStyle(width)}
            data-sized={sizedMark(sizes, property.path)}
            data-query-column={property.path}
            data-query-formula-issue={property.issue ?? undefined}
            aria-sort={
              !ranked && sort?.[0]?.property === property.path
                ? sort[0].direction === "ASC"
                  ? "ascending"
                  : "descending"
                : undefined
            }
            draggable={editable || undefined}
            onDragStart={
              editable ? (event) => moveColumn(event, property.path) : undefined
            }
            {...(editable &&
              (Platform.isMobile
                ? {
                    onClick: (event: MouseEvent<HTMLElement>) =>
                      columnMenu(event, property.path),
                  }
                : {
                    onClick: (event: MouseEvent<HTMLElement>) =>
                      toggleSort(event, property.path),
                    onContextMenu: (event: MouseEvent<HTMLElement>) =>
                      columnMenu(event, property.path),
                  }))}
          >
            {property.issue === null ? (
              <span className={label}>
                <Icon
                  name={icon}
                  data-query-icon={icon}
                  size="xs"
                  className={cn(
                    "zt:flex zt:shrink-0",
                    editable && "zt:group-hover/column:hidden",
                  )}
                />
                {editable && (
                  <Icon
                    name="lucide-grip-vertical"
                    size="xs"
                    className="zt:hidden zt:shrink-0 zt:group-hover/column:flex"
                  />
                )}
                {name}
              </span>
            ) : (
              <span
                className={cn(label, "zt:text-(--text-error)")}
                {...tooltipAttrs(property.issue)}
              >
                <Icon name="alert-triangle" size="xs" className="zt:shrink-0" />
                {name}
              </span>
            )}
            {sorted && (
              <span
                aria-hidden="true"
                className={SORT_MARK}
                data-query-column-sort={sorted.direction}
              >
                <Icon
                  name={
                    sorted.direction === "ASC"
                      ? "lucide-chevron-up"
                      : "lucide-chevron-down"
                  }
                  size="xs"
                />
              </span>
            )}
            {resizable && (
              <span
                className={RESIZER}
                data-query-column-resizer={property.path}
                {...tooltipAttrs(m.query_view_table_resize_column_hint())}
                onPointerDown={(event) => resizeColumn(event, property.path)}
                onDragStart={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onDoubleClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  resetColumn(property.path);
                }}
              />
            )}
          </th>
        );
      })}
      <td
        aria-hidden="true"
        className={cn(cell, filler)}
        data-query-table-filler=""
      />
    </tr>
  );
}

const SORTED_LABEL = "zt:[mask-image:var(--bases-table-header-sort-mask)]";

const SORTED_NAME = "zt:pe-(--size-4-4)";

const SORT_MARK =
  "zt:pointer-events-none zt:absolute zt:-top-px zt:end-0 zt:flex zt:h-full zt:items-center zt:pt-(--size-2-1) zt:pe-(--size-2-3) zt:text-muted-foreground";

const MOVABLE =
  "zt:cursor-grab zt:hover:text-foreground zt:data-dragging:opacity-50";

const RESIZING = "zt-is-resizing-column";

const RESIZER =
  "zt:absolute zt:-end-px zt:inset-y-0 zt:z-(--layer-cover) zt:w-2 zt:cursor-col-resize zt:touch-none zt:after:absolute zt:after:inset-y-1 zt:after:end-px zt:after:w-0.5 zt:after:rounded-full zt:hover:after:bg-(--interactive-accent) zt:[&.is-active]:after:inset-y-0 zt:[&.is-active]:after:bg-(--interactive-accent)";
