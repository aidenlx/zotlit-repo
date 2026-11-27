import type { ConditionIssue } from "#core/query-view/query-file.ts";
import type {
  ViewDiagnostic,
  ViewWarning,
} from "#obsidian/query-view/reader-failure.ts";
import type { QueryViewRow } from "#worker/item-query/query-view.ts";

import { nameDictionary } from "@zotlit/item-query";
import type { NameDictionary } from "@zotlit/item-query";
import type { ReaderDiagnosticSource } from "@zotlit/obsidian-kit/reader-diagnostic.ts";
import type { PlacedFault } from "@zotlit/template-workbench/core/language/index.ts";

import type { ShownRecord } from "./record-rows.tsx";
import type { LayoutGroup } from "./rows.ts";

export type QueryViewWarning = ViewWarning;

export interface ResultSnapshot {
  rows: readonly QueryViewRow[];
  count: number;
  records: readonly ShownRecord[];
  matched: number;
  groups: readonly LayoutGroup[];
  truncated: boolean;
  ranked: boolean;
  warnings: readonly QueryViewWarning[];
  formulaIssues: NameDictionary<FormulaIssue>;
}

export interface FormulaIssue {
  readonly message: string;
  readonly place?: PlacedFault;
}

export interface QueryViewFailure {
  diagnostic: ViewDiagnostic;
  reader: ReaderDiagnosticSource | string;
  filterIssue: ConditionIssue | null;
  formulaIssues: NameDictionary<FormulaIssue>;
}

export const NO_RESULTS: ResultSnapshot = {
  rows: [],
  count: 0,
  records: [],
  matched: 0,
  groups: [],
  truncated: false,
  ranked: false,
  warnings: [],
  formulaIssues: nameDictionary(),
};

export function formulaIssuesOf(state: {
  results: ResultSnapshot | null;
  failure: QueryViewFailure | null;
}): NameDictionary<FormulaIssue> {
  return (
    state.results?.formulaIssues ??
    state.failure?.formulaIssues ??
    NO_RESULTS.formulaIssues
  );
}
