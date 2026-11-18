// The Annotations dataset: Annotation Query over the non-trashed Annotations
// of the Target Libraries, on the same bounded execution as Item Query.
import { Effect } from "effect";

import {
  readParentCandidateSet,
  readAnnotationCandidateSet,
  readAnnotationRowCount,
  readAnnotationScanPage,
  readAnnotationUniverseRows,
} from "@zotlit/db/item-query";
import { formatIndexedKey } from "@zotlit/zotero-types/keys";

import { lowerAnnotationCandidate } from "./annotation-candidates.ts";
import {
  ANNOTATION_FIELDS,
  ANNOTATION_PARENTS,
  ANNOTATION_SORT_FIELDS,
  annotationFieldDefinition,
  annotationFilterRegistry,
  annotationSortableField,
  DEFAULT_ANNOTATION_FIELDS,
} from "./annotation-fields.ts";
import type { QueryAnnotation } from "./annotation-fields.ts";
import { ANNOTATION_LOADING } from "./annotation-hydration.ts";
import type { QueryDataset } from "./dataset.ts";
import type { DatasetRun } from "./execution.ts";
import { matches as isMatch } from "./filter-evaluate.ts";
import { planFilter, planSubexpression } from "./filter-plan.ts";
import { projectColumns } from "./formulas.ts";
import { parentPathResolver, parentRootName } from "./parent-records.ts";
import { ATTACHMENTS } from "./query-attachments.ts";
import { ITEMS } from "./query-items.ts";
import { openRecordLoader } from "./record-loader.ts";
import type { ItemQueryRequest } from "./request.ts";

/** Annotation Query: one Annotation Row for each non-trashed Annotation. */
export const ANNOTATIONS: QueryDataset<ItemQueryRequest> = {
  id: "annotations",
  noun: "Annotation",
  family: "Annotation Query",
  customPrefix: `${annotationFilterRegistry.prefix}.`,
  defaultFields: DEFAULT_ANNOTATION_FIELDS,
  defaultSort: [
    { field: "item.dateModified", direction: "desc" },
    { field: "attachment.indexedKey", direction: "asc" },
    { field: "sortIndex", direction: "asc" },
  ],
  tieBreakers: [{ field: "sortIndex", direction: "asc" }],
  get names() {
    return [
      ...ANNOTATION_FIELDS.keys(),
      ...ANNOTATION_PARENTS.flatMap((parent) => parent.names()),
    ];
  },
  lowerCandidate: lowerAnnotationCandidate,
  readCandidate: readAnnotationCandidateSet,
  readRowCount: readAnnotationRowCount,
  candidateParents: ANNOTATION_PARENTS,
  candidateRelations: {
    item: {
      dataset: () => ITEMS,
      readChildren: ({ leaf, ...page }) =>
        readParentCandidateSet({ ...page, leaf, relation: "annotation-item" }),
    },
    attachment: {
      dataset: () => ATTACHMENTS,
      readChildren: ({ leaf, ...page }) =>
        readParentCandidateSet({
          ...page,
          leaf,
          relation: "annotation-attachment",
        }),
    },
  },
  planSubexpression: (text, at, options) =>
    planSubexpression(text, at, {
      registry: annotationFilterRegistry,
      ...options,
    }),
  sortableFields: ANNOTATION_SORT_FIELDS,
  definition: annotationFieldDefinition,
  filterField: (name) => annotationFilterRegistry.field(name),
  planFilter: (text, context, formula) =>
    planFilter(text, { registry: annotationFilterRegistry, context, formula }),
  sortable: annotationSortableField,
  resolvePath: parentPathResolver(
    annotationFieldDefinition,
    ANNOTATION_PARENTS,
  ),
  rootName: (name) => parentRootName(name, ANNOTATION_PARENTS),
  readScanPage: readAnnotationScanPage,
  readUniverseRows: readAnnotationUniverseRows,
  open: (plan, request, { clock, sources }) =>
    Effect.gen(function* () {
      const { filter, columns } = plan;
      const hydration = yield* openRecordLoader(ANNOTATION_LOADING, plan, {
        libraries: request.libraries,
        sources,
      });
      const run: DatasetRun<QueryAnnotation> = {
        scan: hydration.scan,
        projection: hydration.projection,
        matches: (item) => !filter || isMatch(filter.root, item, clock),
        project: (item, library) => ({
          indexedKey: formatIndexedKey(item.scan.key, library.groupID),
          attachmentIndexedKey: formatIndexedKey(
            item.scan.attachmentKey,
            library.groupID,
          ),
          itemIndexedKey: formatIndexedKey(
            item.scan.parent.key,
            library.groupID,
          ),
          values: projectColumns(columns, item, clock),
        }),
      };
      return run;
    }),
};
