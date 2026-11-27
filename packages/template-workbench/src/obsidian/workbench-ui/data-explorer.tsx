import type {
  DisplayNode,
  TemplateEngine,
  TreeState,
} from "#core/data-tree/index.ts";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { Effect } from "effect";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

import { iconButton } from "@zotlit/obsidian-kit/components/obsidian/icon-button.tsx";
import { Icon } from "@zotlit/obsidian-kit/components/obsidian/icon.tsx";
import { BaseNotice } from "@zotlit/obsidian-kit/notice.ts";
import { tooltipAttrs } from "@zotlit/obsidian-kit/utils.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { runtime } from "@zotlit/plugin-messages/runtime.ts";
import { useUniqueId } from "@zotlit/ui";
import { composing } from "@zotlit/ui";

import { useWorkbenchModel } from "./editor.tsx";
import { explorerSections, listPropertyLabels } from "./explorer-sections.ts";
import type { ExplorerReader } from "./explorer-sections.ts";
import { DisplayTree } from "./explorer-tree.tsx";
import type { DisplaySection, FieldRowState } from "./explorer-tree.tsx";
import { FieldDetails, placeFieldDetails } from "./field-details.tsx";
import {
  fieldForm,
  fieldForms,
  TEMPLATE_INSERTION,
} from "./field-insertion.ts";
import type {
  FieldForm,
  FieldInsertionContext,
  FieldInsertOptions,
} from "./field-insertion.ts";
import { useFieldsPanelRows } from "./fields-panel.tsx";
import { useContainerName, useWorkbenchHost } from "./host.tsx";
import type { WorkbenchClipboardError } from "./host.tsx";
import { showWorkbenchMenu } from "./menu.ts";
import type { WorkbenchMenuItem, WorkbenchMenuRequest } from "./menu.ts";
import { announceFields } from "./model.ts";
import type { TemplateRoot } from "./model.ts";

import {
  buildDisplayTree,
  buildFilteredDisplayTree,
  copyValue,
  formatPath,
  setFilter,
  toggleNode,
} from "#core/data-tree/index.ts";

const dataExplorerHeader =
  "zt-workbench-sidebar-control zt:items-center zt:justify-between zt:gap-x-2 zt:px-3";
const dataExplorerBody =
  "zt:min-h-18 zt:flex-1 zt:overflow-auto zt:overscroll-contain zt:px-2 zt:pb-3";

interface FieldInsertRequest {
  readonly keepOpen?: boolean;
  readonly form?: FieldForm;
}

export interface ExplorerPresentation {
  top: number;
  left: number;
  field: string | null;
  focus?: boolean;
}

export interface DataExplorerProps {
  restore?: ExplorerPresentation | null;
  onRestored?: () => void;
  onPresentationChange?: (value: ExplorerPresentation) => void;
  collapsedSections: ReadonlySet<string>;
  onCollapsedSectionsChange: (collapsed: ReadonlySet<string>) => void;
  navigation: TreeState;
  onNavigationChange: (navigation: TreeState) => void;
  empty?: ReactNode;
  root: TemplateRoot;
  data: Record<string, unknown> | null;
  trigger?: string;
  insertion?: () => FieldInsertionContext;
  engines?: () => readonly TemplateEngine[];
  disabled?: boolean;
  onInsert?: (text: string, options: FieldInsertOptions) => boolean | void;
  copy: (text: string) => Effect.Effect<void, WorkbenchClipboardError>;
  onExploreAnnotation?: (node: DisplayNode) => void;
  canExploreAnnotation?: (node: DisplayNode) => boolean;
}

const ROOT_LABELS: Record<TemplateRoot, () => string> = {
  note: m.workbench_fields_root_note,
  annotation: m.workbench_fields_root_annotation,
  filename: m.workbench_fields_root_filename,
  citation: m.workbench_fields_root_citation,
};

const SEARCH_LABELS: Record<TemplateRoot, () => string> = {
  note: m.workbench_fields_search_note,
  annotation: m.workbench_fields_search_annotation,
  filename: m.workbench_fields_search_filename,
  citation: m.workbench_fields_search_citation,
};

export function DataExplorer({
  restore,
  onRestored,
  onPresentationChange,
  collapsedSections,
  onCollapsedSectionsChange,
  navigation: tree,
  onNavigationChange,
  empty,
  root,
  data,
  trigger,
  insertion = () => TEMPLATE_INSERTION,
  engines,
  disabled = false,
  onInsert,
  copy,
  onExploreAnnotation,
  canExploreAnnotation,
}: DataExplorerProps) {
  const body = useRef<HTMLDivElement>(null);
  const bodyId = useUniqueId();
  const field = useRef<string | null>(null);
  useEffect(() => {
    if (!restore || !body.current || !data) return;
    const element = body.current;
    element.scrollTop = restore.top;
    element.scrollLeft = restore.left;
    field.current = restore.field;
    if (restore.focus && restore.field) {
      const row = [
        ...element.querySelectorAll<HTMLElement>("[data-workbench-field]"),
      ].find((row) => row.dataset.workbenchField === restore.field);
      row
        ?.querySelector<HTMLElement>("button, [tabindex]")
        ?.focus({ preventScroll: true });
    }
    onRestored?.();
  }, [restore, data, onRestored]);
  const host = useWorkbenchHost();
  const model = useWorkbenchModel();
  const startCopy = useAtomSet(model.copy(useUniqueId()));
  const setFields = useAtomSet(model.fieldsPanel);
  const setStatus = useAtomSet(model.fieldsStatus);
  const announce = (text: string) => {
    new BaseNotice(text);
    setStatus(announceFields(text));
  };
  const insertNode =
    onInsert &&
    ((
      node: DisplayNode,
      {
        keepOpen = false,
        form = fieldForm(node, insertion()),
      }: FieldInsertRequest = {},
    ) => {
      if (onInsert(form.snippet, { keepOpen }) === false) return;
      announce(
        m.workbench_fields_inserted({ field: fieldLabel(node, labels) }),
      );
      if (!keepOpen) setFields("to-editor");
    });
  const locale = runtime.getLocale();
  const reader = useMemo<ExplorerReader>(
    () => ({ root, locale }),
    [root, locale],
  );
  const labels = useMemo(() => {
    if (!data) return new Map<string, string>();
    const nodes = buildDisplayTree(data, { expanded: new Set() });
    return new Map([
      ...explorerSections(nodes, reader).flatMap((section) =>
        section.rows.map((row) => [row.node.key, row.label] as const),
      ),
      ...listPropertyLabels(nodes, reader),
    ]);
  }, [data, reader]);
  const panelRows = useFieldsPanelRows();
  const lists = panelRows ? "shape" : "items";
  const visible = useMemo(() => {
    if (!data) return { nodes: [], matchedKeys: null };
    if (tree.filterQuery)
      return buildFilteredDisplayTree(data, tree.filterQuery, {
        collapsed: tree.filterCollapsed,
        aliases: labels,
        lists,
      });
    return {
      nodes: buildDisplayTree(data, { expanded: tree.expanded, lists }),
      matchedKeys: null,
    };
  }, [data, tree, labels, lists]);
  const filtering = tree.filterQuery !== "";
  const canInsert = insertNode !== undefined && !disabled;
  const sections = useMemo<DisplaySection[]>(
    () =>
      explorerSections(visible.nodes, reader).map((section) => ({
        id: section.id,
        label: section.label,
        collapsed: !filtering && collapsedSections.has(section.id),
        nodes: section.rows.map((row) => row.node),
        labels,
      })),
    [visible, reader, filtering, collapsedSections, labels],
  );
  const rows = useFieldRows({
    enabled: panelRows !== null,
    sections,
    labels,
    query: tree.filterQuery,
  });
  const noMatches =
    panelRows !== null && data !== null && filtering && sections.length === 0;
  useEffect(() => {
    const text = m.workbench_fields_no_matches();
    if (noMatches) setStatus(announceFields(text));
    else setStatus((last) => (last?.text === text ? null : last));
  }, [noMatches, setStatus]);
  const detailsSurface = useRef<HTMLElement>(null);
  const [openRow, setOpenRow] = useState<HTMLElement | null>(null);
  const viewSize = useAtomValue(model.viewSize);
  useLayoutEffect(() => {
    const key = rows.open?.node.key ?? null;
    setOpenRow(key === null ? null : rowElement(body.current, key));
  }, [rows.open]);
  const { reveal } = rows;
  useLayoutEffect(() => {
    if (reveal === null || !body.current) return;
    const row = rowElement(body.current, reveal.key);
    if (row) revealRow(body.current, row);
  }, [reveal]);
  const held = useRef<{ element: HTMLElement; top: number } | null>(null);
  const spacer = useRef<HTMLDivElement>(null);
  const holdInPlace = (element: HTMLElement | null) => {
    held.current = element && {
      element,
      top: element.getBoundingClientRect().top,
    };
  };
  useLayoutEffect(() => {
    const hold = held.current;
    const list = body.current;
    const room = spacer.current;
    held.current = null;
    if (!hold || !list || !room || !hold.element.isConnected) return;
    const top =
      list.scrollTop + hold.element.getBoundingClientRect().top - hold.top;
    const short = top - (list.scrollHeight - list.clientHeight);
    if (short > 0) room.style.height = `${room.offsetHeight + short}px`;
    list.scrollTop = top;
  }, [sections]);
  const trimSpacer = (list: HTMLElement) => {
    const room = spacer.current;
    if (!room?.offsetHeight) return;
    const below = list.scrollHeight - list.scrollTop - list.clientHeight;
    room.style.height = `${Math.max(0, room.offsetHeight - below)}px`;
  };
  const openKey = rows.open?.node.key ?? null;
  const searchInput = useRef<HTMLInputElement>(null);
  const shownBefore = useRef(false);
  useLayoutEffect(() => {
    const shown = openKey !== null;
    if (shown || !shownBefore.current) {
      shownBefore.current = shown;
      return;
    }
    shownBefore.current = false;
    const doc = body.current?.ownerDocument;
    if (!doc || (doc.activeElement && doc.activeElement !== doc.body)) return;
    searchInput.current?.focus({ preventScroll: true });
  }, [openKey]);
  const { close: closeDetails } = rows;
  useEffect(() => {
    if (openKey === null) return;
    const doc = body.current?.ownerDocument;
    if (!doc) return;
    const away = (event: Event) => {
      const target = event.target as Node | null;
      if (!target) return;
      const inside = [
        detailsSurface.current,
        rowElement(body.current, openKey),
      ].some((element) => element?.contains(target));
      if (!inside) closeDetails();
    };
    doc.addEventListener("pointerdown", away, true);
    return () => doc.removeEventListener("pointerdown", away, true);
  }, [openKey, closeDetails]);
  useLayoutEffect(() => {
    if (!panelRows) return;
    const { escape: escapeRef } = panelRows;
    escapeRef.current = () => {
      if (rows.open) {
        rows.close();
        return true;
      }
      if (tree.filterQuery === "") return false;
      onNavigationChange(setFilter(tree, ""));
      return true;
    };
    return () => {
      escapeRef.current = () => false;
    };
  });
  const insertEntry = (entry: FieldEntry, request?: FieldInsertRequest) => {
    rows.close();
    insertNode?.(entry.node, request);
  };
  const copyEntry = (entry: FieldEntry, form: FieldForm) => {
    rows.close();
    startCopy({
      copy: copy(form.snippet),
      copied: () => announce(m.workbench_fields_copied({ field: entry.label })),
      failed: () => announce(m.workbench_field_copy_failed()),
    });
  };
  const onSearchKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!panelRows || composing(event)) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      rows.move(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key !== "Enter") return;
    const entry = rows.entries.find((row) => row.node.key === rows.selected);
    if (!entry) return;
    event.preventDefault();
    if (event.metaKey || event.ctrlKey) {
      if (canInsert) insertEntry(entry);
      else announce(m.workbench_fields_choose_place());
    } else rows.toggle(entry.node.key, { focus: true });
  };
  const sectionIds = sections.map((section) => section.id);
  const allCollapsed =
    sectionIds.length > 0 &&
    sectionIds.every((id) => collapsedSections.has(id));
  const sectionsLabel = allCollapsed
    ? m.workbench_explorer_expand_all()
    : m.workbench_explorer_collapse_all();
  const sectionsTooltip = tooltipAttrs(sectionsLabel);
  const toggleSection = (id: string) => {
    holdInPlace(
      body.current?.querySelector<HTMLElement>(
        `[data-workbench-section="${id}"] > [data-part=section-heading]`,
      ) ?? null,
    );
    const next = new Set(collapsedSections);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onCollapsedSectionsChange(next);
  };
  const copyMenu = (text: string) =>
    startCopy({
      copy: copy(text),
      copied: () => {
        new BaseNotice(m.workbench_field_copy_done());
      },
      failed: () => {
        new BaseNotice(m.workbench_field_copy_failed());
      },
    });
  const menuEntries = (node: DisplayNode) => {
    const value = copyValue(node);
    const items: WorkbenchMenuItem[] = [
      {
        label: m.workbench_explorer_menu_copy_path(),
        onSelect: () => copyMenu(formatPath(node.path, "zt")),
      },
      {
        label: m.workbench_explorer_menu_copy_value(),
        disabled: value === null,
        onSelect: () => {
          if (value !== null) copyMenu(value);
        },
      },
    ];
    if (insertNode && !disabled)
      items.unshift({
        label: m.workbench_fields_put_in_note(),
        onSelect: () => insertNode(node),
      });
    const labels = {
      output: m.workbench_explorer_menu_copy_output,
      "if-present": m.workbench_explorer_menu_copy_if_present,
      loop: m.workbench_explorer_menu_copy_loop,
      joined: m.workbench_explorer_menu_copy_joined,
    };
    const context = insertion();
    const languages =
      context.mode === "template"
        ? (engines?.() ?? [context.engine])
        : [context.engine];
    const submenus: NonNullable<WorkbenchMenuRequest["submenus"]>[number][] =
      [];
    for (const language of languages) {
      const snippets = fieldForms(
        node,
        { ...context, engine: language },
        { every: true },
      ).map((form) => ({
        label: labels[form.kind](),
        onSelect: () => copyMenu(form.snippet),
      }));
      if (languages.length > 1)
        submenus.push({
          label: language === "eta" ? "Eta" : "Liquid",
          items: snippets,
        });
      else items.push(...snippets);
    }
    if (onExploreAnnotation && canExploreAnnotation?.(node))
      items.push({
        label: m.workbench_explorer_menu_explore_annotation(),
        onSelect: () => onExploreAnnotation(node),
      });
    return { items, submenus };
  };
  const openTemplateMenu = (node: DisplayNode, event: React.MouseEvent) => {
    showWorkbenchMenu({
      anchor: event.currentTarget as HTMLElement,
      ...menuEntries(node),
    });
  };
  const openFieldContextMenu = (node: DisplayNode, event: React.MouseEvent) => {
    showWorkbenchMenu({
      anchor: event.currentTarget as HTMLElement,
      pointerEvent: event.nativeEvent,
      ...menuEntries(node),
    });
  };
  const sectionsButton = (
    <button
      type="button"
      disabled={filtering || sectionIds.length === 0}
      onClick={() =>
        onCollapsedSectionsChange(
          allCollapsed ? new Set() : new Set(sectionIds),
        )
      }
      {...sectionsTooltip}
      data-part="sections-toggle"
      className={iconButton({ className: "zt:shrink-0" })}
    >
      <Icon name={allCollapsed ? "chevrons-up-down" : "chevrons-down-up"} />
    </button>
  );
  const search = SEARCH_LABELS[root]();
  const searchName = useContainerName(search);
  return (
    <section
      data-part="explorer"
      className="zt-template-data-explorer zt:flex zt:min-h-0 zt:min-w-0 zt:flex-1 zt:flex-col zt:gap-3 zt:pt-3"
    >
      <div data-part="header" className={dataExplorerHeader}>
        <h2 data-part="heading" className="">
          {m.workbench_fields_heading()}
        </h2>
        <span
          data-part="root-label"
          className="zt:text-xs zt:text-muted-foreground"
        >
          {ROOT_LABELS[root]()}
        </span>
      </div>
      <div
        data-part="search-row"
        className="zt:mx-3 zt:flex zt:min-w-0 zt:shrink-0 zt:items-center zt:gap-1"
      >
        <input
          ref={searchInput}
          type="search"
          value={tree.filterQuery}
          {...searchName.attrs}
          placeholder={search}
          {...(panelRows && {
            role: "combobox",
            "aria-expanded": true,
            "aria-autocomplete": "list" as const,
            "aria-controls": bodyId,
            "aria-activedescendant":
              rows.selected === null ? undefined : rows.idOf(rows.selected),
          })}
          data-part="search"
          className="zt:w-auto zt:min-w-0 zt:flex-1"
          onKeyDown={onSearchKey}
          onChange={(event) =>
            onNavigationChange(setFilter(tree, event.currentTarget.value))
          }
        />
        {searchName.hiddenName}
      </div>
      {panelRows?.actions && createPortal(sectionsButton, panelRows.actions)}
      <div
        ref={body}
        id={bodyId}
        data-part="body"
        className={dataExplorerBody}
        onScroll={(event) => {
          trimSpacer(event.currentTarget);
          onPresentationChange?.({
            top: event.currentTarget.scrollTop,
            left: event.currentTarget.scrollLeft,
            field: field.current,
          });
        }}
        onFocusCapture={(event) => {
          field.current =
            (event.target as HTMLElement).closest<HTMLElement>(
              "[data-workbench-field]",
            )?.dataset.workbenchField ?? null;
          onPresentationChange?.({
            top: event.currentTarget.scrollTop,
            left: event.currentTarget.scrollLeft,
            field: field.current,
          });
        }}
      >
        {sections.length === 0 ? (
          (empty ?? (
            <p
              data-part="empty"
              className="zt:px-1 zt:py-3 zt:text-muted-foreground zt:text-sm zt:leading-normal"
            >
              {data === null
                ? m.workbench_fields_no_annotations()
                : m.workbench_fields_no_matches()}
            </p>
          ))
        ) : (
          <DisplayTree
            sections={sections}
            matchedKeys={visible.matchedKeys}
            onToggle={(key) => {
              holdInPlace(rowElement(body.current, key));
              onNavigationChange(toggleNode(tree, key));
            }}
            onToggleSection={filtering ? undefined : toggleSection}
            onInsert={
              insertNode && !disabled
                ? (node, keepOpen) => insertNode(node, { keepOpen })
                : undefined
            }
            onTemplateMenu={openTemplateMenu}
            onFieldContextMenu={openFieldContextMenu}
            rows={
              panelRows
                ? {
                    ...rows.state,
                    onRowClick: (node) => {
                      rows.state.onRowClick(node);
                      searchInput.current?.focus({ preventScroll: true });
                    },
                  }
                : undefined
            }
          />
        )}
        <div ref={spacer} aria-hidden="true" />
      </div>
      {rows.open && (
        <FieldDetails
          key={rows.open.node.key}
          placement={placeFieldDetails(viewSize)}
          row={openRow}
          surface={detailsSurface}
          node={rows.open.node}
          label={rows.open.label}
          context={rows.open.context}
          forms={fieldForms(rows.open.node, insertion())}
          takeFocus={rows.focusDetails}
          onInsert={
            insertNode && !disabled
              ? (form, { keepOpen }) =>
                  insertEntry(rows.open!, { keepOpen, form })
              : undefined
          }
          onCopy={(form) => copyEntry(rows.open!, form)}
          onClose={rows.close}
          onTabOut={() => searchInput.current?.focus({ preventScroll: true })}
        />
      )}
      {trigger && (
        <p
          data-part="hint"
          className="zt:px-3 zt:pt-1 zt:pb-2 zt:text-xs zt:leading-(--line-height-tight) zt:text-muted-foreground"
        >
          {m.workbench_fields_trigger_hint({ trigger })}
        </p>
      )}
      {panelRows && (
        <p
          data-part="keys-hint"
          className="zt:shrink-0 zt:border-t zt:border-border zt:px-3 zt:py-1.5 zt:text-xs zt:text-muted-foreground"
        >
          {canInsert
            ? m.workbench_fields_details_hint({
                insert:
                  host.fieldsAction?.insertShortcut ??
                  m.workbench_fields_insert_key(),
              })
            : m.workbench_fields_details_hint_no_place({
                hint: m.workbench_fields_details_hint_view(),
                reason: m.workbench_fields_choose_place(),
              })}
        </p>
      )}
    </section>
  );
}

interface FieldEntry {
  readonly node: DisplayNode;
  readonly label: string;
  readonly context: string;
}

export function fieldLabel(
  node: DisplayNode,
  labels: ReadonlyMap<string, string>,
): string {
  return labels.get(node.key) ?? node.label;
}

function fieldEntries(
  sections: readonly DisplaySection[],
  labels: ReadonlyMap<string, string>,
): FieldEntry[] {
  const entries: FieldEntry[] = [];
  const visit = (nodes: readonly DisplayNode[], context: string) => {
    for (const node of nodes) {
      const label = fieldLabel(node, labels);
      entries.push({ node, label, context });
      if (node.kind === "value" && node.children)
        visit(node.children, `${context} · ${label}`);
    }
  };
  for (const section of sections)
    if (!section.collapsed) visit(section.nodes, section.label);
  return entries;
}

function useFieldRows({
  enabled,
  sections,
  labels,
  query,
}: {
  enabled: boolean;
  sections: readonly DisplaySection[];
  labels: ReadonlyMap<string, string>;
  query: string;
}) {
  const prefix = useUniqueId();
  const [state, setState] = useState({
    query,
    selected: null as string | null,
    open: null as string | null,
    focus: false,
    reveal: null as { readonly key: string } | null,
  });
  let { selected, open } = state;
  if (state.query !== query) {
    selected = null;
    open = null;
    setState({ query, selected, open, focus: false, reveal: null });
  }
  const entries = useMemo(
    () => (enabled ? fieldEntries(sections, labels) : []),
    [enabled, sections, labels],
  );
  const index = new Map(entries.map((entry, at) => [entry.node.key, at]));
  if (selected !== null && !index.has(selected)) selected = null;
  const openEntry =
    open === null ? null : (entries[index.get(open) ?? -1] ?? null);
  const idOf = (key: string) => `${prefix}-row-${index.get(key) ?? -1}`;
  const [close] = useState(
    () => () => setState((last) => ({ ...last, open: null })),
  );
  const toggle = (key: string, { focus = false }: { focus?: boolean } = {}) =>
    setState((last) => ({
      ...last,
      selected: key,
      open: last.open === key ? null : key,
      focus,
    }));
  const move = (step: 1 | -1) => {
    if (entries.length === 0) return;
    const at = selected === null ? -1 : index.get(selected)!;
    const next =
      at < 0
        ? step > 0
          ? 0
          : entries.length - 1
        : Math.min(entries.length - 1, Math.max(0, at + step));
    const key = entries[next]!.node.key;
    setState((last) => ({ ...last, selected: key, reveal: { key } }));
  };
  const rowState: FieldRowState = {
    selected,
    open: openEntry?.node.key ?? null,
    idOf,
    onRowClick: (node) => toggle(node.key),
  };
  return {
    entries,
    selected,
    open: openEntry,
    focusDetails: state.focus,
    reveal: state.reveal,
    idOf,
    close,
    toggle,
    move,
    state: rowState,
  };
}

function revealRow(body: HTMLElement, row: HTMLElement): void {
  const heading = row
    .closest("[data-workbench-section]")
    ?.querySelector<HTMLElement>(":scope > [data-part=section-heading]");
  const view = body.getBoundingClientRect();
  const box = row.getBoundingClientRect();
  const top = view.top + (heading?.offsetHeight ?? 0);
  if (box.top < top) body.scrollTop -= top - box.top;
  else if (box.bottom > view.bottom) body.scrollTop += box.bottom - view.bottom;
}

function rowElement(body: HTMLElement | null, key: string): HTMLElement | null {
  const item = [
    ...(body?.querySelectorAll<HTMLElement>("[data-workbench-field]") ?? []),
  ].find((element) => element.dataset.workbenchField === key);
  return item?.querySelector<HTMLElement>(":scope > [data-part=row]") ?? null;
}
