import { Context } from "effect";
import type { Effect } from "effect";

import type { Attachment } from "@zotlit/db";
import type {
  ParentCandidates,
  TextSweepCandidateLeaf,
  ParentCandidateLeaf,
  ItemQueryDatabase,
  ItemQueryReaderError,
  ScanRow,
} from "@zotlit/db/item-query";

import type { CandidateSources } from "./candidate-plan.ts";
import type { ItemQueryError } from "./error.ts";
import type { DatasetRun } from "./execution.ts";
import type { FaultedFormulaRead, Span } from "./fault.ts";
import type {
  FieldDefinition,
  FieldNeeds,
  FilterField,
  SortKey,
} from "./fields.ts";
import type {
  FilterNode,
  FilterPlan,
  FilterProblem,
  FormulaResolver,
  PlannedSubexpression,
} from "./filter-plan.ts";
import type { ParentRecord } from "./parent-records.ts";
import type { PathSegment } from "./projection-path.ts";
import type { QueryClock } from "./query-clock.ts";
import type { QuerySources } from "./query-sources.ts";
import type {
  ItemQueryPlan,
  ItemQueryRequest,
  QueryContext,
  SortSpec,
} from "./request.ts";

export function fieldRoot(name: string): string {
  return name.split(".")[0]!.split("[")[0]!;
}

export interface SortableField<Item, Needs = FieldNeeds> {
  readonly needs: Needs;
  readonly key: (item: Item, clock: QueryClock) => SortKey;
}

export type ResolveAttachmentFile = (attachment: Attachment) => Effect.Effect<{
  readonly path: string | null;
  readonly exists: boolean;
}>;

export const AttachmentFileResolver =
  Context.Reference<ResolveAttachmentFile | null>(
    "@zotlit/item-query/AttachmentFileResolver",
    { defaultValue: () => null },
  );

export type CandidatePageReader = (page: {
  libraryID: number;
  limit: number;
  afterItemID?: number;
}) => Effect.Effect<number[], ItemQueryReaderError, ItemQueryDatabase>;

export interface CandidateRelation {
  readonly dataset: () => CandidateDataset;
  readonly readParents: (chunk: {
    libraryID: number;
    itemIDs: readonly number[];
  }) => Effect.Effect<number[], ItemQueryReaderError, ItemQueryDatabase>;
}

export interface CandidateParentRelation {
  readonly dataset: () => CandidateDataset;
  readonly readChildren: (page: {
    libraryID: number;
    limit: number;
    budget: number;
    leaf: ParentCandidateLeaf;
  }) => Effect.Effect<
    ParentCandidates,
    ItemQueryReaderError,
    ItemQueryDatabase
  >;
}

export interface CandidateDataset<Leaf = any> {
  readonly id: "items" | "attachments" | "annotations";
  readonly lowerCandidate: (
    node: FilterNode<never>,
    sources: CandidateSources,
  ) => Leaf | null;
  readonly lowerSweep?: (
    node: FilterNode<never>,
    sources: CandidateSources,
  ) => TextSweepCandidateLeaf | null;
  readonly readCandidate: (
    page: Parameters<CandidatePageReader>[0] & { leaf: Leaf },
  ) => ReturnType<CandidatePageReader>;
  readonly readRowCount: (
    libraryID: number,
  ) => Effect.Effect<number, ItemQueryReaderError, ItemQueryDatabase>;
  readonly candidateParents: readonly ParentRecord[];
  readonly candidateRelations: Readonly<
    Record<string, CandidateRelation | CandidateParentRelation>
  >;
  readonly filterField: (name: string) => FilterField<any, any> | undefined;
}

export interface QueryDataset {
  readonly id: CandidateDataset["id"];
  readonly noun: string;
  readonly family: string;
  readonly customPrefix: string;
  readonly defaultFields: readonly string[];
  readonly defaultSort: readonly SortSpec[];
  readonly tieBreakers: readonly SortSpec[];
  readonly names: readonly string[];
  readonly sortableFields: readonly string[];
  readonly definition: (name: string) => FieldDefinition<any, any> | undefined;
  readonly filterField: (name: string) => FilterField<any, any> | undefined;
  readonly planFilter: (
    text: string,
    context?: QueryContext,
    formula?: FormulaResolver<any, any>,
  ) => FilterPlan<any, any> | FilterProblem | FaultedFormulaRead;
  readonly planSubexpression: (
    text: string,
    at: Span,
    options?: {
      readonly context?: QueryContext;
      readonly formula?: FormulaResolver<any, any>;
    },
  ) => PlannedSubexpression | undefined;
  readonly sortable: (name: string) => SortableField<any, any> | undefined;
  readonly resolvePath: (segments: readonly PathSegment[]) =>
    | {
        readonly field: FieldDefinition<any, any>;
        readonly rest: readonly PathSegment[];
      }
    | undefined;
  readonly rootName: (name: string) => string;
}

export interface QueryEngine extends CandidateDataset {
  readonly readScanPage: (page: {
    libraryID: number;
    afterItemID: number;
    size: number;
  }) => Effect.Effect<
    readonly ScanRow[],
    ItemQueryReaderError,
    ItemQueryDatabase
  >;
  readonly readUniverseRows: (chunk: {
    libraryID: number;
    itemIDs: readonly number[];
  }) => Effect.Effect<
    readonly ScanRow[],
    ItemQueryReaderError,
    ItemQueryDatabase
  >;
  open(
    plan: ItemQueryPlan,
    request: ItemQueryRequest,
    context: { readonly clock: QueryClock; readonly sources: QuerySources },
  ): Effect.Effect<
    DatasetRun<any>,
    ItemQueryError | ItemQueryReaderError,
    ItemQueryDatabase
  >;
}
