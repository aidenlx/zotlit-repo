import type {
  FilterLocation,
  QueryFile,
  QueryFileView,
} from "#core/query-view/query-file.ts";
import type {
  ConditionFault,
  FilterSplit,
} from "#core/query-view/view-plan/filter-split.ts";
import type {
  QueryViewRequest,
  QueryViewRow,
} from "#desktop/item-query/query-view.ts";
import type { LayoutRows } from "#desktop/query-view/rows.ts";
import type { VaultHost, VaultValue } from "#desktop/query-view/table-notes.ts";

import type { QueryContext } from "@zotlit/item-query";
import type { ReaderDiagnosticSource } from "@zotlit/obsidian-kit/reader-diagnostic.ts";
import type { Span } from "@zotlit/template-workbench/core/language/index.ts";
import type { LibraryScope } from "@zotlit/zotero-reads/contract/library-scope.ts";

import { planVaultFilter } from "./vault-filter.ts";
import type { VaultFilter } from "./vault-filter.ts";

import { isVaultProperty } from "#core/query-view/query-file.ts";
import { splitFilters } from "#core/query-view/view-plan/filter-split.ts";
import { grouping } from "#desktop/query-view/datasets.ts";
import { layoutOf } from "#desktop/query-view/layouts.ts";
import { PAPERS_FIELDS } from "#desktop/query-view/papers-layout.tsx";
import { layoutRows } from "#desktop/query-view/rows.ts";
import { TABLE_FIELDS } from "#desktop/query-view/table-layout.tsx";
import {
  vaultSortRequest,
  vaultSortedLayout,
} from "#desktop/query-view/vault-sort.ts";
import {
  unusedSettings,
  usedGroupBy,
  viewProperties,
} from "#desktop/query-view/view-properties.ts";

export interface ViewPlanNotes {
  itemKeys(): Iterable<string>;
  read(itemKey: string, name: string, host: VaultHost | null): VaultValue;
}

export interface ViewPlanSources {
  context(): QueryContext | undefined;
  libraries?(): LibraryScope | undefined;
  fields?(view: QueryFileView): readonly string[];
  host(): VaultHost | null;
  notes: ViewPlanNotes;
}

export interface ViewPlanFault {
  readonly at: FilterLocation;
  readonly diagnostic: ReaderDiagnosticSource;
}

export interface ViewPlan {
  readonly key: string;
  readonly request: QueryViewRequest;
  readonly fault: ViewPlanFault | null;
  readonly keys: string | null;
  layout<R extends QueryViewRow>(
    rows: readonly R[],
  ): LayoutRows & { dropped: boolean };
  locate(span: Span): ConditionFault | null;
}

export class ViewPlanner {
  readonly #sources: ViewPlanSources;
  #split: { file: QueryFile; view: QueryFileView; split: FilterSplit } | null =
    null;
  #vaultFilter: { key: string; filter: VaultFilter } | null = null;

  constructor(sources: ViewPlanSources) {
    this.#sources = sources;
  }

  notesChanged(): void {
    this.#vaultFilter = null;
  }

  plan(file: QueryFile, view: QueryFileView): ViewPlan {
    const split = this.#splitOf(file, view);
    const host = this.#sources.host();
    const vaultFilter = this.#vaultFilterOf(split, view, host);
    const keys = "condition" in vaultFilter ? vaultFilter.condition : null;
    const engine = split.engine(keys);
    const unused = new Set(unusedSettings(view).sort);
    const used =
      view.sort?.filter(({ property }) => !unused.has(property)) ?? [];
    const sort = used.filter(({ property }) => !isVaultProperty(property));
    const vaultSort = used.filter(({ property }) => isVaultProperty(property));
    const grouped = view.groupBy && grouping(view.from, view.groupBy.property);
    const fields = [
      ...new Set([
        ...(grouped?.fields ?? []),
        ...layoutFields(view),
        ...(this.#sources.fields?.(view) ?? []),
        ...viewProperties(file, view).queried.map(({ path }) => path),
      ]),
    ];
    const formulas = file.formulas ?? {};
    const context = this.#sources.context();
    const libraries = this.#sources.libraries?.();
    const request: QueryViewRequest = {
      from: view.from ?? "annotations",
      ...(engine && { filter: engine.text }),
      ...(sort.length > 0 && {
        sort: sort.map(({ property, direction }) => ({
          field: property,
          direction: direction === "DESC" ? "desc" : "asc",
        })),
      }),
      fields,
      ...(Object.keys(formulas).length > 0 && { formulas }),
      limit: view.limit ?? null,
      ...(libraries && { libraries }),
      ...(context && { context }),
    };
    const planned = vaultSort.length > 0 ? vaultSortRequest(request) : request;
    const notes = this.#sources.notes;
    return {
      key: JSON.stringify([
        planned,
        {
          sort: vaultSort,
          conditions: split.vault.map(({ section, path, text }) => ({
            section,
            path,
            text,
          })),
          filter: vaultFilter,
        },
        view.limit ?? null,
        usedGroupBy(view) ?? null,
        view.groupOrder ?? null,
      ]),
      request: planned,
      fault: "fault" in vaultFilter ? vaultFilter.fault : null,
      keys,
      layout: (rows) =>
        vaultSort.length > 0
          ? vaultSortedLayout(rows, view, {
              sort: used,
              read: (row, name) => notes.read(row.indexedKey, name, host),
            })
          : { ...layoutRows(rows, view), dropped: false },
      locate: (span) => engine?.locate(span) ?? null,
    };
  }

  #splitOf(file: QueryFile, view: QueryFileView): FilterSplit {
    if (this.#split?.file !== file || this.#split.view !== view)
      this.#split = { file, view, split: splitFilters(file, view) };
    return this.#split.split;
  }

  #vaultFilterOf(
    { vault, stranded }: FilterSplit,
    view: QueryFileView,
    host: VaultHost | null,
  ): VaultFilter {
    const keyPath =
      (view.from ?? "annotations") === "items"
        ? "indexedKey"
        : "item.indexedKey";
    const key = JSON.stringify([vault, stranded, keyPath, host]);
    if (this.#vaultFilter?.key === key) return this.#vaultFilter.filter;
    const { notes } = this.#sources;
    const filter = planVaultFilter({
      conditions: vault,
      stranded,
      notes: {
        itemKeys: () => notes.itemKeys(),
        read: (itemKey, name) => notes.read(itemKey, name, host),
      },
      keyPath,
    });
    this.#vaultFilter = { key, filter };
    return filter;
  }
}

function layoutFields(view: QueryFileView): readonly string[] {
  switch (layoutOf(view)?.type) {
    case "table":
      return TABLE_FIELDS;
    case "papers":
      return PAPERS_FIELDS;
    default:
      return [];
  }
}
