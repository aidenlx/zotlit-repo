import { Effect } from "effect";

import { parseIndexedKey } from "@zotlit/zotero-types/keys";

import type { QueryDataset } from "./dataset.ts";
import type { Diagnostic } from "./diagnose.ts";
import { ItemQueryError } from "./error.ts";
import type { ItemQueryErrorCode } from "./error.ts";
import type { ItemQueryFault } from "./fault.ts";
import type { FieldNeeds, QueryItem, SortKey } from "./fields.ts";
import type { FilterPlan } from "./filter-plan.ts";
import { formulaOrderFault, planFormulas } from "./formulas.ts";
import type {
  FormulaFaultPolicy,
  FormulaSourceCheck,
  PlannedColumn,
  PlannedFormula,
} from "./formulas.ts";
import type { NameDictionary } from "./name-dictionary.ts";
import { canGroup, planPath, readPath } from "./projection.ts";
import type { PlannedPath } from "./projection.ts";
import type { QueryClock } from "./query-clock.ts";

export interface TargetLibrary {
  readonly libraryID: number;
  readonly groupID: number | null;
}

export interface ItemQueryRequest {
  readonly uses?: Readonly<Record<string, number>>;
  readonly libraries: readonly TargetLibrary[];
  readonly filter?: string | undefined;
  readonly fields?: readonly string[] | undefined;
  readonly sort?: readonly SortSpec[] | undefined;
  readonly group?: string | undefined;
  readonly limit?: number | null | undefined;
  readonly context?: QueryContext | undefined;
  readonly formulas?: Readonly<Record<string, string>> | undefined;
  readonly onFormulaFault?: FormulaFaultPolicy | undefined;
}

export type FormulaDiagnostics = NameDictionary<Diagnostic<ItemQueryErrorCode>>;

export interface QueryContext {
  readonly item?: string | undefined;
  readonly attachment?: string | undefined;
}

export interface SortSpec {
  readonly field: string;
  readonly direction: "asc" | "desc";
}

export interface ItemQuery {
  readonly filter: string | null;
  readonly fields: readonly string[];
  readonly sort: readonly SortSpec[];
  readonly limit: number | null;
  readonly group?: string;
  readonly context?: QueryContext;
  readonly formulas?: Readonly<Record<string, string>>;
}

export type ProjectionValue =
  | null
  | string
  | number
  | boolean
  | Temporal.Instant
  | Temporal.PlainDate
  | Temporal.PlainYearMonth
  | readonly ProjectionValue[]
  | { readonly [key: string]: ProjectionValue };

export interface QueryRow {
  readonly indexedKey: string;
  readonly attachmentIndexedKey?: string;
  readonly itemIndexedKey?: string;
  readonly values: Readonly<Record<string, ProjectionValue>>;
}

export type GroupValue = string | number | boolean | null;

export interface QueryGroup {
  readonly value: GroupValue;
  readonly count: number;
  readonly rows: readonly QueryRow[];
}

export type QueryResult = QueryMetadata &
  (
    | {
        readonly rows: readonly QueryRow[];
        readonly groups?: never;
        readonly totalCount?: never;
      }
    | {
        readonly groups: readonly QueryGroup[];
        readonly totalCount: number;
        readonly rows?: never;
      }
  );

export interface QueryMetadata {
  readonly warnings: readonly Diagnostic<
    | "never-true"
    | "always-true"
    | "key-outside-target-libraries"
    | "unknown-collection"
    | "unused-formula"
  >[];
  readonly formulaDiagnostics?: FormulaDiagnostics;
  readonly query: ItemQuery;
  readonly returnedCount: number;
  readonly truncated: boolean;
}

export interface ItemQueryPlan<Item = any, Needs = any> {
  readonly dataset: QueryDataset<any>;
  readonly query: ItemQuery;
  readonly filter: FilterPlan<Item, Needs> | null;
  readonly paths: readonly PlannedPath<Item, Needs>[];
  readonly formulas: readonly PlannedFormula<Item, Needs>[];
  readonly unusedFormulas: readonly string[];
  readonly formulaDiagnostics: FormulaDiagnostics | null;
  readonly columns: readonly PlannedColumn<Item, Needs>[];
  readonly group: PlannedGroup<Item, Needs> | null;
  readonly groupNeeds: readonly Needs[];
  readonly order: readonly SortSpec[];
  readonly sorts: readonly PlannedSort<Item, Needs>[];
}

export interface PlannedGroup<
  Item = QueryItem,
  Needs = FieldNeeds,
> extends PlannedPath<Item, Needs> {
  readonly values: (item: Item) => readonly GroupValue[];
}

function groupValues<Item, Needs>(
  path: PlannedPath<Item, Needs>,
): PlannedGroup<Item, Needs>["values"] {
  const wire = (value: ProjectionValue) =>
    JSON.parse(JSON.stringify(value)) as GroupValue;
  if (path.each === 0) return (item) => [wire(readPath(path, item))];
  return (item) => {
    const elements = readPath(path, item);
    const values = new Set<GroupValue>();
    if (Array.isArray(elements))
      for (const element of elements) {
        const value = wire(element);
        if (value !== null) values.add(value);
      }
    return values.size === 0 ? [null] : [...values];
  };
}

export interface PlannedSort<Item = QueryItem, Needs = FieldNeeds> {
  readonly direction: SortSpec["direction"];
  readonly needs: Needs;
  readonly key: (item: Item, clock: QueryClock) => SortKey;
}

export const COUNT_FIELDS: readonly string[] = [];
export const UNLIMITED_LIMIT = "all";

export function planRequest(
  dataset: QueryDataset<any>,
  request: ItemQueryRequest,
  sourceCheck?: FormulaSourceCheck,
): Effect.Effect<ItemQueryPlan, ItemQueryError> {
  return Effect.gen(function* () {
    const libraryIDs = request.libraries.map((library) => library.libraryID);
    const repeated = libraryIDs.findIndex(
      (libraryID, index) => libraryIDs.indexOf(libraryID) !== index,
    );
    if (repeated !== -1) {
      return yield* new ItemQueryError({
        dataset,
        location: { argument: "libraries", index: repeated },
        fault: {
          kind: "plain",
          code: "duplicate-library",
          message: `The request names the Library with the local ID ${libraryIDs[repeated]} twice.`,
          action: "Name each Target Library once.",
        },
      });
    }

    let context: QueryContext | undefined;
    for (const member of ["item", "attachment"] as const) {
      const key = request.context?.[member];
      if (key === undefined) continue;
      const parsed = parseIndexedKey(key);
      if (!parsed || (parsed.groupID !== null && parsed.groupID <= 0)) {
        return yield* new ItemQueryError({
          dataset,
          location: { argument: "context", path: `context.${member}` },
          fault: {
            kind: "plain",
            code: "invalid-context",
            message: `this.${member} names ${JSON.stringify(key)}, which is not an Indexed Key.`,
            action:
              'Bind an Indexed Key: a Zotero Key such as "ABCD2345", with g<groupID> after it for a group Library.',
          },
        });
      }
      context = { ...context, [member]: key };
    }

    const fields = request.fields ?? dataset.defaultFields;
    const formulas = planFormulas(dataset, {
      formulas: request.formulas,
      filter: request.filter,
      fields,
      context,
      policy: request.onFormulaFault ?? "fail",
      sourceCheck,
    });
    if (formulas instanceof ItemQueryError) return yield* formulas;

    let filter: FilterPlan | null = null;
    if (request.filter !== undefined) {
      const planned = dataset.planFilter(
        request.filter,
        context,
        formulas.resolve,
      );
      if ("kind" in planned) {
        if (planned.kind === "reads-faulted-formula")
          return yield* formulas.filterFailure(planned);
        return yield* new ItemQueryError({
          dataset,
          context,
          fault: planned,
          location: {
            argument: "filter",
            span:
              planned.kind === "syntax"
                ? { from: planned.fault.from, to: planned.fault.to }
                : planned.at,
          },
          argumentText: request.filter,
        });
      }
      filter = planned;
    }

    const paths: PlannedPath[] = [];
    const columns: PlannedColumn[] = [];
    for (const [index, text] of fields.entries()) {
      const formula = formulas.column(index);
      if (formula instanceof ItemQueryError) return yield* formula;
      if (formula === "left-out") continue;
      if (formula !== null) {
        columns.push(formula);
        continue;
      }
      const path = planPath(text, dataset.resolvePath);
      if ("kind" in path) {
        return yield* new ItemQueryError({
          dataset,
          fault: path,
          location: { argument: "fields", index, path: `fields[${index}]` },
          argumentText: JSON.stringify(fields),
        });
      }
      paths.push(path);
      columns.push({ kind: "path", path });
    }

    let group: PlannedGroup | null = null;
    if (request.group !== undefined) {
      const text = request.group;
      const fail = (fault: ItemQueryFault) =>
        new ItemQueryError({
          dataset,
          fault,
          location: { argument: "group" },
          argumentText: text,
        });
      const byFormula = formulaOrderFault("invalid-group", text);
      if (byFormula) return yield* fail(byFormula);
      const path = planPath(text, dataset.resolvePath);
      if ("kind" in path) return yield* fail(path);
      if (!canGroup(path.shape, path.each))
        return yield* fail({
          kind: "group",
          problem:
            path.each > 1
              ? "each"
              : path.each === 0 && path.shape.kind === "list"
                ? "list"
                : "scalar",
          name: text,
          at: { from: 0, to: text.length },
        });
      group = { ...path, values: groupValues(path) };
    }

    const sort = request.sort ?? dataset.defaultSort;
    const sorts: PlannedSort<any, any>[] = [];
    for (const [index, { field, direction }] of sort.entries()) {
      const byFormula = formulaOrderFault("unsortable-field", field);
      if (byFormula) {
        return yield* new ItemQueryError({
          dataset,
          location: { argument: "sort", index, path: `sort[${index}].field` },
          argumentText: JSON.stringify(sort),
          fault: byFormula,
        });
      }
      const sortable = dataset.sortable(field);
      if (!sortable) {
        return yield* new ItemQueryError({
          dataset,
          location: { argument: "sort", index, path: `sort[${index}].field` },
          argumentText: JSON.stringify(sort),
          fault: {
            kind: "unknown",
            role: "sortable-field",
            name: field,
            at: { from: 0, to: field.length },
          },
        });
      }
      sorts.push({ direction, ...sortable });
    }
    const tieBreakers = dataset.tieBreakers.filter(
      (tie) => !sort.some(({ field }) => field === tie.field),
    );
    for (const { field, direction } of tieBreakers) {
      sorts.push({ direction, ...dataset.sortable(field)! });
    }

    const limit = request.limit ?? null;
    if (limit !== null && !(Number.isSafeInteger(limit) && limit > 0)) {
      return yield* new ItemQueryError({
        dataset,
        location: { argument: "limit" },
        fault: {
          kind: "plain",
          code: "invalid-limit",
          message: `The limit ${limit} is not a positive integer.`,
          action:
            "Use a positive integer, or omit the limit to get every match.",
        },
      });
    }

    const planned = formulas.finish();
    const normalized = sort.map(({ field, direction }) => ({
      field,
      direction,
    }));
    return {
      dataset,
      query: {
        filter: request.filter ?? null,
        fields: [...fields],
        sort: normalized,
        limit,
        ...(request.group === undefined ? {} : { group: request.group }),
        ...(context === undefined ? {} : { context }),
        ...(request.formulas === undefined
          ? {}
          : { formulas: { ...request.formulas } }),
      },
      filter,
      paths,
      formulas: planned.planned,
      unusedFormulas: planned.unused,
      formulaDiagnostics: planned.diagnostics,
      columns,
      group,
      groupNeeds: group ? [group.needs] : [],
      order: [...normalized, ...tieBreakers],
      sorts,
    };
  });
}
