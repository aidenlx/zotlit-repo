import type { IconName } from "obsidian";
import type { ReactNode } from "react";
import { useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";

import type {
  ChooserActionRow,
  ChooserGroup,
  ChooserItemRow,
  ChooserRow,
} from "@zotlit/obsidian-kit/components/chooser-logic.ts";
import {
  Chooser,
  chooserIconButton,
  useChooserPage,
  useChooserQuery,
  useChooserScope,
} from "@zotlit/obsidian-kit/components/chooser.tsx";
import { Icon } from "@zotlit/obsidian-kit/components/obsidian/icon.tsx";
import { registerKeymap } from "@zotlit/obsidian-kit/disposables.ts";
import { cn, tooltipAttrs } from "@zotlit/obsidian-kit/utils.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { composing } from "@zotlit/ui";

import { useQueryViewState } from "./model.ts";
import { propertyIcon } from "./property-icon.ts";
import { NewFormulaPage, PropertyPage } from "./property-page.tsx";
import { useVaultPropertyNames } from "./vault-cell.tsx";
import type { PropertyEntry, ViewProperties } from "./view-properties.ts";
import { isVaultPropertyName, useViewProperties } from "./view-properties.ts";
import type { QueryView } from "./view.tsx";

import {
  LITERATURE_NOTE,
  vaultName,
  vaultProperty,
} from "#core/query-view/query-file.ts";
import {
  ToolbarButtonContent,
  toolbarButtonClass,
} from "#obsidian/query-view/toolbar-button.tsx";

const NEW_FORMULA_PAGE = "zt:new-formula";

function reordered(
  order: readonly string[],
  moved: string,
  target: string,
): string[] {
  const next = order.filter((property) => property !== moved);
  const at = next.indexOf(target);
  if (at < 0) return [...order];
  const after = order.indexOf(moved) < order.indexOf(target);
  next.splice(after ? at + 1 : at, 0, moved);
  return next;
}

export function PropertiesMenu({ view }: { view: QueryView }) {
  const current = useQueryViewState(view, (s) => s.view);
  const { literatureNotes } = view.tableDeps;
  const names = useVaultPropertyNames(literatureNotes);
  const properties = useViewProperties(view, names);
  if (!current || !properties) return null;
  const order = properties.visible.map((entry) => entry.path);
  const setOrder = (next: readonly string[]) =>
    view.document.editView({ order: properties.orderOf(next) });
  const dataset = current.from ?? "annotations";

  return (
    <Chooser value={order} onValueChange={setOrder}>
      <Chooser.Trigger
        className={toolbarButtonClass}
        aria-label={m.query_view_properties()}
        data-query-properties=""
      >
        <ToolbarButtonContent icon="list" label={m.query_view_properties()} />
      </Chooser.Trigger>
      <Chooser.Popup
        className="zt:[max-height:min(--spacing(120),calc(100vh_-_--spacing(2)))] zt:min-w-60"
        data-query-properties-popup=""
      >
        <Chooser.Input
          placeholder={m.query_view_properties_search()}
          clearLabel={m.query_view_clear_search()}
        />
        <PropertyList
          properties={properties}
          order={order}
          setOrder={setOrder}
          iconOf={(entry) =>
            propertyIcon(dataset, entry, (name) =>
              literatureNotes.propertyType(name),
            )
          }
          pages={view.can.propertyPages}
          vaults={dataset === "items"}
        />
        <Chooser.Page>
          {(page) => {
            if (page === NEW_FORMULA_PAGE)
              return <NewFormulaPage view={view} />;
            const entry = properties.kept(page);
            if (!entry) return <Chooser.PageGone />;
            const shown = order.includes(page);
            return (
              <PropertyPage
                view={view}
                entry={entry}
                shown={shown}
                onShownChange={(show) =>
                  view.document.editView({
                    order: properties.withShown(page, show),
                  })
                }
              />
            );
          }}
        </Chooser.Page>
      </Chooser.Popup>
    </Chooser>
  );
}

function PropertyList({
  properties,
  order,
  setOrder,
  iconOf,
  pages,
  vaults,
}: {
  properties: ViewProperties;
  order: readonly string[];
  setOrder: (next: readonly string[]) => void;
  iconOf: (entry: PropertyEntry) => string;
  pages: boolean;
  vaults: boolean;
}) {
  const query = useChooserQuery().trim();
  const { scope, activeValue } = useChooserScope();
  const { page, openPage } = useChooserPage();
  const [dragging, setDragging] = useState<string | null>(null);
  const [moves, resort] = useReducer((count: number) => count + 1, 0);
  const sortKey = `${moves}:${page === null}:${query}`;
  const sortOf = (key: string) => ({
    key,
    paths: listedProperties(properties, query).map((entry) => entry.path),
  });
  const [sorted, setSorted] = useState(() => sortOf(sortKey));
  let paths = sorted.paths;
  if (sorted.key !== sortKey) {
    const next = sortOf(sortKey);
    paths = next.paths;
    setSorted(next);
  }
  const rows = useMemo(
    () => listedProperties(properties, query, paths),
    [properties, query, paths],
  );
  const byPath = useMemo(
    () => new Map(rows.map((entry) => [entry.path, entry])),
    [rows],
  );
  const sharedLabels = useMemo(() => {
    const seen = new Set<string>();
    const shared = new Set<string>();
    for (const { label } of properties.entries)
      (seen.has(label) ? shared : seen).add(label);
    return shared;
  }, [properties]);
  const keys = useRef({ order, setOrder, page });
  useLayoutEffect(() => {
    keys.current = { order, setOrder, page };
  });
  const groups = useMemo<ChooserGroup<ChooserRow>[]>(() => {
    const items = rows.map((entry): ChooserItemRow => ({
      ...propertyRow(entry),
      ...(pages && { next: () => openPage(entry.path) }),
    }));
    const actions: ChooserActionRow[] = [];
    const typedVault = vaultName(query);
    if (
      query !== "" &&
      !byPath.has(query) &&
      (typedVault === null || isVaultPropertyName(typedVault))
    )
      actions.push({
        id: "add-property",
        label: m.query_view_properties_add({ name: query }),
        action: () => setOrder([...order, query]),
      });
    const vault = vaultProperty(query);
    if (
      vaults &&
      typedVault === null &&
      isVaultPropertyName(query) &&
      !byPath.has(vault)
    )
      actions.push({
        id: "add-vault-property",
        label: m.query_view_properties_add_vault({ name: query }),
        action: () => setOrder([...order, vault]),
      });
    if (pages)
      actions.push({
        id: "add-formula",
        label: m.query_view_formula_add(),
        action: () => openPage(NEW_FORMULA_PAGE),
      });
    actions.push({
      id: "hide-all",
      label: m.query_view_properties_hide_all(),
      action: () => {
        setOrder([]);
        resort();
      },
    });
    return [{ items }, { items: actions, pinned: true }];
  }, [rows, byPath, order, query, setOrder, openPage, pages, vaults]);

  useLayoutEffect(() => {
    const move = (step: number) => (event: KeyboardEvent) => {
      if (composing(event) || keys.current.page !== null) return;
      const path = activeValue();
      const { order: now, setOrder: save } = keys.current;
      const at = path === null ? -1 : now.indexOf(path);
      if (at < 0) return false;
      const to = Math.min(Math.max(at + step, 0), now.length - 1);
      if (to !== at) {
        const next = [...now];
        next.splice(to, 0, ...next.splice(at, 1));
        save(next);
        resort();
      }
      return false;
    };
    const stack = new DisposableStack();
    stack.use(registerKeymap(scope, ["Alt"], "ArrowUp", move(-1)));
    stack.use(registerKeymap(scope, ["Alt"], "ArrowDown", move(1)));
    return () => stack.dispose();
  }, [scope, activeValue]);

  return (
    <Chooser.List
      groups={groups}
      label={m.query_view_properties()}
      emptyLabel={m.query_view_properties_empty()}
    >
      {(row) => {
        if (row.action)
          return (
            <Chooser.Action
              key={row.id}
              id={row.id}
              data-query-properties-action={row.id}
              leading={
                <RowIcon
                  className="zt:text-(--icon-color)"
                  name={
                    row.id === "hide-all"
                      ? "eye-off"
                      : row.id === "add-formula"
                        ? "square-function"
                        : "plus"
                  }
                />
              }
            >
              {row.label}
            </Chooser.Action>
          );
        const entry = byPath.get(row.value);
        if (!entry) return null;
        const shown = order.includes(row.value);
        return (
          <Chooser.Item
            key={row.value}
            value={row.value}
            data-query-property={row.value}
            data-hidden={shown ? undefined : ""}
            draggable={shown}
            className={cn(
              "zt:data-hidden:text-(--text-faint) zt:data-hidden:[--icon-color:var(--text-faint)]",
              dragging === row.value && "zt:opacity-50",
            )}
            onDragStart={(event) => {
              setDragging(row.value);
              event.dataTransfer?.setData("text/plain", row.value);
              if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(event) => {
              if (dragging !== null && order.includes(row.value))
                event.preventDefault();
            }}
            onDrop={(event) => {
              event.preventDefault();
              if (dragging !== null && dragging !== row.value) {
                setOrder(reordered(order, dragging, row.value));
                resort();
              }
              setDragging(null);
            }}
            onDragEnd={() => setDragging(null)}
            leading={
              <>
                <input
                  type="checkbox"
                  checked={shown}
                  readOnly
                  tabIndex={-1}
                  aria-hidden
                  className="zt:m-0 zt:shrink-0"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={(event) => event.preventDefault()}
                />
                <TypeIcon entry={entry} icon={iconOf(entry)} grab={shown} />
              </>
            }
            end={
              pages && (
                <button
                  type="button"
                  tabIndex={-1}
                  className={cn(chooserIconButton, "zt:-m-(--size-2-2)")}
                  data-query-property-more={row.value}
                  {...tooltipAttrs(m.query_view_property_edit())}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={(event) => {
                    event.stopPropagation();
                    openPage(entry.path);
                  }}
                >
                  <RowIcon name="chevron-right" />
                </button>
              )
            }
          >
            <span data-query-property-name="">{entry.label}</span>
            {(sharedLabels.has(entry.label) ||
              (entry.kind === "vault" && entry.path !== LITERATURE_NOTE)) &&
              entry.label !== entry.path && (
                <span className="zt:text-(--text-faint)"> {entry.path}</span>
              )}
          </Chooser.Item>
        );
      }}
    </Chooser.List>
  );
}

function RowIcon({ name, className }: { name: IconName; className?: string }) {
  return <Icon name={name} size="s" className={cn("zt:shrink-0", className)} />;
}

function TypeIcon({
  entry: { issue },
  icon,
  grab,
}: {
  entry: PropertyEntry;
  icon: IconName;
  grab: boolean;
}): ReactNode {
  return (
    <span
      className={cn(
        "zt:flex zt:shrink-0 zt:text-(--icon-color)",
        grab && "zt:cursor-grab zt:active:cursor-grabbing",
        issue !== null && "zt:text-(--text-error)",
      )}
      data-query-formula-issue={issue ?? undefined}
      {...(issue === null ? {} : tooltipAttrs(issue))}
    >
      <RowIcon name={icon} />
    </span>
  );
}

export function propertyRow({
  path,
  label,
  searchTerms,
}: Pick<PropertyEntry, "path" | "label" | "searchTerms">): ChooserItemRow {
  return {
    value: path,
    label: label === path ? path : `${label} ${path}`,
    searchTerms,
  };
}

export function listedProperties(
  properties: Pick<ViewProperties, "entries" | "kept">,
  query: string,
  before?: readonly string[],
): PropertyEntry[] {
  const listable = (entry: PropertyEntry) =>
    entry.place !== null || query !== "" || !entry.nested;
  if (before === undefined) return properties.entries.filter(listable);
  const kept = before.flatMap((path) => properties.kept(path) ?? []);
  const known = new Set(before);
  return [
    ...kept,
    ...properties.entries.filter(
      (entry) => !known.has(entry.path) && listable(entry),
    ),
  ];
}
