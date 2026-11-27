import { regex } from "arkregex";

import { parseExpressionAst } from "@zotlit/filter-expression";
import type { ExpressionNode } from "@zotlit/filter-expression";

import type { QueryDataset } from "./dataset.ts";
import type { ItemQueryErrorCode, ItemQueryErrorLocation } from "./error.ts";
import { ItemQueryError } from "./error.ts";
import type { FaultedFormulaRead, ItemQueryFault, Span } from "./fault.ts";
import type { DateValue } from "./filter-dates.ts";
import { dateText } from "./filter-dates.ts";
import {
  EVALUATION_ERROR_CODES,
  isError,
  renderEvaluationFault,
} from "./filter-error.ts";
import { evaluateFormula } from "./filter-evaluate.ts";
import type { FilterPlan, FormulaResolver } from "./filter-plan.ts";
import type { FilterValue } from "./filter-values.ts";
import { isDate, isList } from "./filter-values.ts";
import { nameDictionary } from "./name-dictionary.ts";
import { parseProjectionPath } from "./projection-path.ts";
import type { PathProblem, PlannedPath } from "./projection.ts";
import { readPath } from "./projection.ts";
import type { QueryClock } from "./query-clock.ts";
import type {
  FormulaDiagnostics,
  ProjectionValue,
  QueryContext,
} from "./request.ts";

export const FORMULA_SEGMENT = "formula";

export const FORMULA_NAME = regex("^[A-Za-z_][A-Za-z0-9_]*$");

export interface FormulaReference {
  readonly name: string;
  readonly from: number;
  readonly to: number;
}

export function formulaReferences(text: string): FormulaReference[] {
  const { ast } = parseExpressionAst(text);
  const found: FormulaReference[] = [];
  const visit = (node: ExpressionNode) => {
    if (
      node.type === "object-access" &&
      node.object.type === "identifier" &&
      node.object.name === FORMULA_SEGMENT
    ) {
      found.push({ name: node.property, from: node.from, to: node.to });
      return;
    }
    for (const child of expressionChildren(node)) visit(child);
  };
  if (ast) visit(ast);
  return found.sort((a, b) => a.from - b.from);
}

interface FormulaCycle {
  readonly chain: readonly string[];
  readonly at: Span;
}

function formulaCycles(
  defined: Readonly<Record<string, string>>,
): Map<string, FormulaCycle> {
  const reads = new Map(
    Object.entries(defined).map(([name, text]) => [
      name,
      formulaReferences(text).filter((read) =>
        Object.hasOwn(defined, read.name),
      ),
    ]),
  );
  const cycles = new Map<string, FormulaCycle>();
  for (const [start, first] of reads) {
    const via = new Map<string, string>();
    let found: string | null = null;
    let at: Span | null = null;
    const queue = [start];
    walk: for (const name of queue) {
      for (const read of reads.get(name)!) {
        if (read.name === start) {
          found = name;
          if (name === start) at = read;
          break walk;
        }
        if (via.has(read.name)) continue;
        via.set(read.name, name);
        queue.push(read.name);
      }
    }
    if (found === null) continue;
    const chain = [start];
    for (let name = found; name !== start; name = via.get(name)!)
      chain.splice(1, 0, name);
    chain.push(start);
    at ??= first.find((read) => read.name === chain[1])!;
    cycles.set(start, { chain, at: { from: at.from, to: at.to } });
  }
  return cycles;
}

function expressionChildren(node: ExpressionNode): readonly ExpressionNode[] {
  switch (node.type) {
    case "binary":
      return [node.left, node.right];
    case "unary":
      return [node.operand];
    case "call":
      return [node.callee, ...node.args];
    case "array-access":
      return [node.object, node.index];
    case "object-access":
      return [node.object];
    case "array":
      return node.elements;
    case "group":
      return [node.expression];
    default:
      return [];
  }
}

export const FORMULA_SCHEMA = {
  path: `${FORMULA_SEGMENT}.<name>`,
  name: FORMULA_NAME.source,
  results: ["boolean", "number", "string", "list", "date"],
  codes: [
    "invalid-formula-name",
    "invalid-formula-result",
    "unknown-formula",
    "formula-cycle",
  ] satisfies ItemQueryErrorCode[],
  warnings: ["unused-formula"],
  error: {
    type: "error",
    row: { kind: "error", code: "<code>", message: "<message>" },
    codes: EVALUATION_ERROR_CODES,
  },
};

export type FormulaFaultPolicy = "fail" | "leave-out";

export interface PlannedFormula<Item = any, Needs = any> {
  readonly name: string;
  readonly text: string;
  readonly plan: FilterPlan<Item, Needs>;
}

interface FaultedFormula {
  readonly name: string;
  readonly text: string;
  readonly fault:
    | { readonly kind: "own"; readonly error: FormulaError }
    | FaultedFormulaRead;
}

export interface FormulaError {
  readonly fault: ItemQueryFault;
  readonly location: ItemQueryErrorLocation & { readonly argument: "formulas" };
  readonly argumentText: string;
  readonly context?: QueryContext | undefined;
}

export interface FormulaSourceFault {
  readonly fault: ItemQueryFault;
  readonly at: Span;
}

export type FormulaSourceCheck = (
  plan: Pick<FilterPlan, "customFields">,
) => FormulaSourceFault | null;

export interface FormulaRequest {
  readonly formulas: Readonly<Record<string, string>> | undefined;
  readonly filter: string | undefined;
  readonly fields: readonly string[];
  readonly context: QueryContext | undefined;
  readonly policy: FormulaFaultPolicy;
  readonly sourceCheck?: FormulaSourceCheck | undefined;
}

export interface FormulaPlanner<Item = any, Needs = any> {
  readonly resolve: FormulaResolver<Item, Needs>;
  readonly filterFailure: (read: FaultedFormulaRead) => ItemQueryError;
  readonly column: (
    index: number,
  ) =>
    | Extract<PlannedColumn<Item, Needs>, { kind: "formula" }>
    | "left-out"
    | ItemQueryError
    | null;
  readonly finish: () => PlannedFormulas<Item, Needs>;
}

export interface PlannedFormulas<Item = any, Needs = any> {
  readonly planned: readonly PlannedFormula<Item, Needs>[];
  readonly unused: readonly string[];
  readonly diagnostics: FormulaDiagnostics | null;
}

export function planFormulas(
  dataset: QueryDataset,
  request: FormulaRequest,
): FormulaPlanner | ItemQueryError {
  const { context, fields, sourceCheck } = request;
  const leaveOut = request.policy === "leave-out";
  const defined = nameDictionary(Object.entries(request.formulas ?? {}));
  const names = Object.keys(defined);
  const invalidNames: FaultedFormula[] = names
    .filter((name) => !FORMULA_NAME.test(name))
    .map((name) => ({
      name,
      text: defined[name]!,
      fault: {
        kind: "own",
        error: {
          location: { argument: "formulas", path: name },
          fault: { kind: "formula-name", name },
          argumentText: name,
        },
      },
    }));
  const rootError = ({ fault }: FaultedFormula): FormulaError =>
    fault.kind === "own" ? fault.error : fault.root;
  const failure = (faulted: FaultedFormula) =>
    new ItemQueryError({ dataset, ...rootError(faulted) });
  const [invalidName] = invalidNames;
  if (invalidName && !leaveOut) return failure(invalidName);

  const cycles = leaveOut ? formulaCycles(defined) : new Map<string, never>();
  const planned = new Map<string, PlannedFormula>();
  const faulted = new Map<string, FaultedFormula>(
    invalidNames.map((formula) => [formula.name, formula]),
  );
  const undefinedColumns = new Map<string, ItemQueryError>();
  const planning: string[] = [];

  const unknown = (name: string, at: Span) =>
    ({ kind: "unknown", role: "formula", name, at, formulas: names }) as const;

  const plan = (name: string): PlannedFormula | FaultedFormula => {
    const known = planned.get(name) ?? faulted.get(name);
    if (known) return known;
    const text = defined[name]!;
    const cycle = cycles.get(name);
    if (cycle) {
      const formula: FaultedFormula = {
        name,
        text,
        fault: {
          kind: "own",
          error: {
            context,
            fault: { kind: "formula-cycle", ...cycle },
            location: { argument: "formulas", path: name, span: cycle.at },
            argumentText: text,
          },
        },
      };
      faulted.set(name, formula);
      return formula;
    }
    planning.push(name);
    let result: ReturnType<typeof dataset.planFilter>;
    try {
      result = dataset.planFilter(text, context, resolve);
    } finally {
      planning.pop();
    }
    const own = (fault: ItemQueryFault, span: Span): FaultedFormula => ({
      name,
      text,
      fault: {
        kind: "own",
        error: {
          context,
          fault,
          location: { argument: "formulas", path: name, span },
          argumentText: text,
        },
      },
    });
    let formula: PlannedFormula | FaultedFormula;
    if ("kind" in result && result.kind === "reads-faulted-formula") {
      formula = { name, text, fault: result };
    } else if ("kind" in result) {
      formula = own(
        result,
        result.kind === "syntax"
          ? { from: result.fault.from, to: result.fault.to }
          : result.at,
      );
    } else {
      const found = result.root.valueType;
      const fromSource = sourceCheck?.(result);
      if (found === "duration" || found === "regexp" || found === "record") {
        const at = { from: result.root.from, to: result.root.to };
        formula = own({ kind: "formula-result", name, found, at }, at);
      } else if (fromSource) {
        formula = own(fromSource.fault, fromSource.at);
      } else {
        formula = { name, text, plan: result };
      }
    }
    if ("fault" in formula) faulted.set(name, formula);
    else planned.set(name, formula);
    return formula;
  };

  const resolve: FormulaResolver<any, any> = (name, at) => {
    if (!Object.hasOwn(defined, name)) return unknown(name, at);
    const open = planning.indexOf(name);
    if (open !== -1) {
      return {
        kind: "formula-cycle",
        chain: [...planning.slice(open), name],
        at,
      };
    }
    const formula = plan(name);
    if ("fault" in formula) {
      return {
        kind: "reads-faulted-formula",
        name,
        at,
        root: rootError(formula),
      };
    }
    return { root: formula.plan.root, needs: formula.plan.needs };
  };

  const ownError = ({ name, text, fault }: FaultedFormula): FormulaError => {
    if (fault.kind === "own") return fault.error;
    return {
      context,
      fault,
      location: { argument: "formulas", path: name, span: fault.at },
      argumentText: text,
    };
  };

  const planReads = (texts: readonly string[]) => {
    const invalid = new Set(invalidNames.map((formula) => formula.name));
    const queued = new Set<string>();
    const queue = [...texts];
    const enqueuePlanned = () => {
      for (const formula of [...planned.values(), ...faulted.values()]) {
        if (invalid.has(formula.name) || queued.has(formula.name)) continue;
        queued.add(formula.name);
        queue.push(formula.text);
      }
    };
    enqueuePlanned();
    for (let text = queue.pop(); text !== undefined; text = queue.pop()) {
      for (const { name } of formulaReferences(text))
        if (
          Object.hasOwn(defined, name) &&
          !planned.has(name) &&
          !faulted.has(name)
        )
          plan(name);
      enqueuePlanned();
    }
  };

  const diagnostics = (): FormulaDiagnostics =>
    nameDictionary(
      [
        ...[...faulted.values()].map(
          (formula) =>
            [
              formula.name,
              new ItemQueryError({ dataset, ...ownError(formula) }),
            ] as const,
        ),
        ...undefinedColumns,
      ].map(([name, error]) => [name, error.diagnostic] as const),
    );

  const column: FormulaPlanner["column"] = (index) => {
    const text = fields[index]!;
    const name = formulaPath(text, defined);
    if (name === null) return null;
    const fieldFailure = (fault: ItemQueryFault) =>
      new ItemQueryError({
        dataset,
        fault,
        location: { argument: "fields", index, path: `fields[${index}]` },
        argumentText: JSON.stringify(fields),
      });
    if (typeof name === "object") return fieldFailure(name);
    if (!Object.hasOwn(defined, name)) {
      const error = fieldFailure(unknown(name, { from: 0, to: text.length }));
      if (!leaveOut) return error;
      if (!undefinedColumns.has(name)) undefinedColumns.set(name, error);
      return "left-out";
    }
    const formula = plan(name);
    if ("fault" in formula) return leaveOut ? "left-out" : failure(formula);
    return { kind: "formula", formula };
  };

  return {
    resolve,
    column,
    filterFailure: (read) => {
      if (!leaveOut) return new ItemQueryError({ dataset, ...read.root });
      for (const index of fields.keys()) column(index);
      const filter = request.filter ?? "";
      planReads([filter]);
      return new ItemQueryError({
        dataset,
        context,
        fault: read,
        location: { argument: "filter", span: read.at },
        argumentText: filter,
        formulaDiagnostics: diagnostics(),
      });
    },
    finish: () => {
      if (!leaveOut) {
        return {
          planned: [...planned.values()],
          unused: names.filter(
            (name) => !planned.has(name) && !faulted.has(name),
          ),
          diagnostics: null,
        };
      }
      planReads([]);
      return {
        planned: [...planned.values()],
        unused: [],
        diagnostics: diagnostics(),
      };
    },
  };
}

function formulaPath(
  text: string,
  defined: Readonly<Record<string, string>>,
): string | null | PathProblem {
  const prefix = `${FORMULA_SEGMENT}.`;
  if (
    text.startsWith(prefix) &&
    Object.hasOwn(defined, text.slice(prefix.length))
  )
    return text.slice(prefix.length);
  const parsed = parseProjectionPath(text);
  if (!parsed.ok || parsed.segments[0] !== FORMULA_SEGMENT) return null;
  const [, name, ...rest] = parsed.segments;
  if (
    typeof name === "string" &&
    rest.length === 0 &&
    text === `${FORMULA_SEGMENT}.${name}`
  )
    return name;
  return {
    kind: "plain",
    code: "invalid-path",
    action:
      typeof name === "string" && FORMULA_NAME.test(name)
        ? `Read the Formula as ${FORMULA_SEGMENT}.${name}.`
        : `Read a Formula as ${FORMULA_SEGMENT}.<name>.`,
    at: { from: 0, to: text.length },
    message: `"${text}" is not a Formula path: fields reads a Formula as ${FORMULA_SEGMENT}.<name>, and a Query Row holds its value under that key.`,
  };
}

export function formulaOrderFault(
  code: "unsortable-field" | "invalid-group",
  text: string,
): PathProblem | null {
  const parsed = parseProjectionPath(text);
  if (!parsed.ok || parsed.segments[0] !== FORMULA_SEGMENT) return null;
  const verb = code === "invalid-group" ? "group" : "sort";
  return {
    kind: "plain",
    code,
    at: { from: 0, to: text.length },
    message: `A query cannot ${verb} by ${text} yet: it ${verb}s by a field, not by a Formula.`,
    action: `${verb === "group" ? "Group" : "Sort"} by a field of the Query Dataset.`,
  };
}

export type PlannedColumn<Item = any, Needs = any> =
  | { readonly kind: "path"; readonly path: PlannedPath<Item, Needs> }
  | { readonly kind: "formula"; readonly formula: PlannedFormula<Item, Needs> };

export function projectColumns<Item>(
  columns: readonly PlannedColumn<Item>[],
  item: Item,
  clock: QueryClock,
): Record<string, ProjectionValue> {
  const values: Record<string, ProjectionValue> = {};
  for (const column of columns) {
    if (column.kind === "path")
      values[column.path.text] = readPath(column.path, item);
    else
      values[`${FORMULA_SEGMENT}.${column.formula.name}`] = formulaValue(
        evaluateFormula(column.formula.plan.root, item, clock),
      );
  }
  return values;
}

export function formulaValue(value: FilterValue): ProjectionValue {
  if (value === null || typeof value !== "object") return value;
  if (isList(value)) return value.map(formulaValue);
  if (isDate(value)) return dateObject(value);
  if (isError(value)) {
    return {
      kind: "error",
      code: value.fault.code,
      message: renderEvaluationFault(value.fault),
    };
  }
  return null;
}

function dateObject(date: DateValue): ProjectionValue {
  if (date.precision === "instant") return date.instant;
  const { first } = date;
  const raw = dateText(date);
  switch (date.precision) {
    case "year":
      return {
        kind: "year",
        value: null,
        year: first.year,
        month: null,
        day: null,
        text: null,
        raw,
      };
    case "month":
      return {
        kind: "yearMonth",
        value: first.toPlainYearMonth(),
        year: first.year,
        month: first.month,
        day: null,
        text: null,
        raw,
      };
    case "day":
      return {
        kind: "date",
        value: first,
        year: first.year,
        month: first.month,
        day: first.day,
        text: null,
        raw,
      };
  }
}
