import { Effect } from "effect";

import {
  readCandidateSet,
  readRelationCandidateSet,
  readLibraryRowCount,
  readScanPage,
  readUniverseRows,
} from "@zotlit/db/item-query";
import { formatIndexedKey } from "@zotlit/zotero-types/keys";

import { lowerItemCandidate } from "./candidate-plan.ts";
import { fieldRoot } from "./dataset.ts";
import type { QueryDataset } from "./dataset.ts";
import type { DatasetRun } from "./execution.ts";
import {
  BUILT_IN_NAMES,
  DEFAULT_FIELDS,
  fieldDefinition,
  filterField,
} from "./fields.ts";
import type { QueryItem } from "./fields.ts";
import { matches as isMatch } from "./filter-evaluate.ts";
import { planFilter, planSubexpression } from "./filter-plan.ts";
import { projectColumns } from "./formulas.ts";
import { ITEM_LOADING } from "./hydration.ts";
import { resolveItemPath } from "./projection.ts";
import { ANNOTATIONS } from "./query-annotations.ts";
import { ATTACHMENTS } from "./query-attachments.ts";
import { openRecordLoader } from "./record-loader.ts";
import type { ItemQueryRequest } from "./request.ts";
import { lowerTextSweep } from "./text-sweep.ts";

const sortable = (name: string) => {
  const definition = fieldDefinition(name);
  return definition?.sortKey
    ? { needs: definition.needs([]), key: definition.sortKey }
    : undefined;
};

export const ITEMS: QueryDataset<ItemQueryRequest> = {
  id: "items",
  noun: "Item",
  family: "Item Query",
  customPrefix: "",
  defaultFields: DEFAULT_FIELDS,
  defaultSort: [{ field: "dateModified", direction: "desc" }],
  tieBreakers: [],
  names: BUILT_IN_NAMES,
  lowerCandidate: lowerItemCandidate,
  lowerSweep: lowerTextSweep,
  readCandidate: readCandidateSet,
  readRowCount: readLibraryRowCount,
  candidateParents: [],
  candidateRelations: {
    attachments: {
      dataset: () => ATTACHMENTS,
      readParents: (chunk) =>
        readRelationCandidateSet({ ...chunk, relation: "item-attachments" }),
    },
    annotations: {
      dataset: () => ANNOTATIONS,
      readParents: (chunk) =>
        readRelationCandidateSet({ ...chunk, relation: "item-annotations" }),
    },
  },
  planSubexpression: (text, at, options) =>
    planSubexpression(text, at, { ...options }),
  sortableFields: BUILT_IN_NAMES.filter((name) => sortable(name)),
  definition: fieldDefinition,
  filterField,
  planFilter: (text, context, formula) =>
    planFilter(text, { context, formula }),
  sortable,
  resolvePath: resolveItemPath,
  rootName: fieldRoot,
  readScanPage,
  readUniverseRows,
  open: (plan, { libraries, uses }, { clock, sources }) =>
    Effect.gen(function* () {
      const { filter, columns } = plan;
      const hydration = yield* openRecordLoader(ITEM_LOADING, plan, {
        libraries,
        sources,
        uses,
      });
      const run: DatasetRun<QueryItem> = {
        scan: hydration.scan,
        projection: hydration.projection,
        matches: (item) => !filter || isMatch(filter.root, item, clock),
        project: (item, library, scan) => ({
          indexedKey: formatIndexedKey(scan.key, library.groupID),
          values: projectColumns(columns, item, clock),
        }),
      };
      return run;
    }),
};
