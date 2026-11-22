import type {
  FormulaDiagnostics,
  GroupValue,
  ItemQuery,
  QueryContext,
  QuerySummary,
  SortSpec,
} from "@zotlit/item-query";
import type { LibraryScope } from "@zotlit/zotero-reads/contract/library-scope.ts";

import type { Diagnostic, LibraryWire } from "./contract.ts";
import type { QueryDatasetId } from "./worker-protocol.ts";

export interface QueryViewRequest {
  readonly from: QueryDatasetId;
  readonly filter?: string;
  readonly fields?: readonly string[];
  readonly formulas?: Readonly<Record<string, string>>;
  readonly sort?: readonly SortSpec[];
  readonly group?: string;
  readonly limit?: number | null;
  readonly libraries?: LibraryScope;
  readonly context?: QueryContext;
}

export type QueryViewValue =
  | null
  | string
  | number
  | boolean
  | readonly QueryViewValue[]
  | { readonly [key: string]: QueryViewValue };

export interface QueryViewRow {
  readonly indexedKey: string;
  readonly attachmentIndexedKey?: string;
  readonly itemIndexedKey?: string;
  readonly values: Readonly<Record<string, QueryViewValue>>;
}

export interface QueryViewGroup {
  readonly value: GroupValue;
  readonly count: number;
  readonly rows: readonly QueryViewRow[];
}

export type QueryViewResult = {
  readonly libraries: readonly LibraryWire[];
  readonly query: ItemQuery;
  readonly returnedCount: number;
  readonly matchedCount: number;
  readonly truncated: boolean;
  readonly warnings: QuerySummary["warnings"];
  readonly formulaDiagnostics?: FormulaDiagnostics;
} & (
  | {
      readonly rows: readonly QueryViewRow[];
      readonly groups?: never;
      readonly totalCount?: never;
    }
  | {
      readonly groups: readonly QueryViewGroup[];
      readonly totalCount: number;
      readonly rows?: never;
    }
);

export type QueryViewOutcome =
  | { readonly kind: "result"; readonly result: QueryViewResult }
  | {
      readonly kind: "failed";
      readonly diagnostic: Diagnostic;
      readonly formulaDiagnostics?: FormulaDiagnostics;
    }
  | { readonly kind: "cancelled" };
