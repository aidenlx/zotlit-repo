import { Effect } from "effect";

import {
  readAnnotationCandidateSet,
  readAnnotationRowCount,
  readAnnotationScanPage,
  readAnnotationUniverseRows,
  readAttachmentCandidateSet,
  readAttachmentRowCount,
  readAttachmentScanPage,
  readAttachmentUniverseRows,
  readCandidateSet,
  readLibraryRowCount,
  readParentCandidateSet,
  readRelationCandidateSet,
  readScanPage,
  readUniverseRows,
} from "@zotlit/db/item-query";
import { formatIndexedKey } from "@zotlit/zotero-types/keys";

import { lowerAnnotationCandidate } from "./annotation-candidates.ts";
import {
  ANNOTATION_PARENTS,
  annotationFilterRegistry,
} from "./annotation-fields.ts";
import type { QueryAnnotation } from "./annotation-fields.ts";
import { ANNOTATION_LOADING } from "./annotation-hydration.ts";
import { lowerAttachmentCandidate } from "./attachment-candidates.ts";
import {
  ATTACHMENT_PARENTS,
  attachmentFilterRegistry,
} from "./attachment-fields.ts";
import type { QueryAttachment } from "./attachment-fields.ts";
import { ATTACHMENT_LOADING } from "./attachment-hydration.ts";
import { lowerItemCandidate } from "./candidate-plan.ts";
import type { QueryDataset, QueryEngine } from "./dataset.ts";
import type { DatasetRun } from "./execution.ts";
import { filterField } from "./fields.ts";
import type { QueryItem } from "./fields.ts";
import { matches as isMatch } from "./filter-evaluate.ts";
import { projectColumns } from "./formulas.ts";
import { ITEM_LOADING } from "./hydration.ts";
import { openRecordLoader } from "./record-loader.ts";
import { lowerTextSweep } from "./text-sweep.ts";

export const ITEM_ENGINE: QueryEngine = {
  id: "items",
  filterField,
  lowerCandidate: lowerItemCandidate,
  lowerSweep: lowerTextSweep,
  readCandidate: readCandidateSet,
  readRowCount: readLibraryRowCount,
  candidateParents: [],
  candidateRelations: {
    attachments: {
      dataset: () => ATTACHMENT_ENGINE,
      readParents: (chunk) =>
        readRelationCandidateSet({ ...chunk, relation: "item-attachments" }),
    },
    annotations: {
      dataset: () => ANNOTATION_ENGINE,
      readParents: (chunk) =>
        readRelationCandidateSet({ ...chunk, relation: "item-annotations" }),
    },
  },
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

export const ATTACHMENT_ENGINE: QueryEngine = {
  id: "attachments",
  filterField: (name) => attachmentFilterRegistry.field(name),
  lowerCandidate: lowerAttachmentCandidate,
  readCandidate: readAttachmentCandidateSet,
  readRowCount: readAttachmentRowCount,
  candidateParents: ATTACHMENT_PARENTS,
  candidateRelations: {
    item: {
      dataset: () => ITEM_ENGINE,
      readChildren: ({ leaf, ...page }) =>
        readParentCandidateSet({ ...page, leaf, relation: "attachment-item" }),
    },
    annotations: {
      dataset: () => ANNOTATION_ENGINE,
      readParents: (chunk) =>
        readRelationCandidateSet({
          ...chunk,
          relation: "attachment-annotations",
        }),
    },
  },
  readScanPage: readAttachmentScanPage,
  readUniverseRows: readAttachmentUniverseRows,
  open: (plan, request, { clock, sources }) =>
    Effect.gen(function* () {
      const { filter, columns } = plan;
      const hydration = yield* openRecordLoader(ATTACHMENT_LOADING, plan, {
        libraries: request.libraries,
        sources,
      });
      const run: DatasetRun<QueryAttachment> = {
        scan: hydration.scan,
        projection: hydration.projection,
        matches: (item) => !filter || isMatch(filter.root, item, clock),
        project: (item, library) => ({
          indexedKey: formatIndexedKey(item.scan.key, library.groupID),
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

export const ANNOTATION_ENGINE: QueryEngine = {
  id: "annotations",
  filterField: (name) => annotationFilterRegistry.field(name),
  lowerCandidate: lowerAnnotationCandidate,
  readCandidate: readAnnotationCandidateSet,
  readRowCount: readAnnotationRowCount,
  candidateParents: ANNOTATION_PARENTS,
  candidateRelations: {
    item: {
      dataset: () => ITEM_ENGINE,
      readChildren: ({ leaf, ...page }) =>
        readParentCandidateSet({ ...page, leaf, relation: "annotation-item" }),
    },
    attachment: {
      dataset: () => ATTACHMENT_ENGINE,
      readChildren: ({ leaf, ...page }) =>
        readParentCandidateSet({
          ...page,
          leaf,
          relation: "annotation-attachment",
        }),
    },
  },
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

const ENGINES = {
  items: ITEM_ENGINE,
  attachments: ATTACHMENT_ENGINE,
  annotations: ANNOTATION_ENGINE,
} as const;

export function datasetEngine(dataset: QueryDataset): QueryEngine {
  return ENGINES[dataset.id];
}
