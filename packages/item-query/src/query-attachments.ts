// The Attachments dataset: Attachment Query over the non-trashed Attachments
// of the Target Libraries, on the same bounded execution as Item Query.
import { Effect } from "effect";

import {
  readAttachmentCandidateSet,
  readRelationCandidateSet,
  readParentCandidateSet,
  readAttachmentRowCount,
  readAttachmentScanPage,
  readAttachmentUniverseRows,
} from "@zotlit/db/item-query";
import { formatIndexedKey } from "@zotlit/zotero-types/keys";

import { lowerAttachmentCandidate } from "./attachment-candidates.ts";
import {
  ATTACHMENT_FIELDS,
  ATTACHMENT_PARENTS,
  ATTACHMENT_SORT_FIELDS,
  attachmentFieldDefinition,
  attachmentFilterRegistry,
  attachmentSortableField,
  DEFAULT_ATTACHMENT_FIELDS,
} from "./attachment-fields.ts";
import type { QueryAttachment } from "./attachment-fields.ts";
import { ATTACHMENT_LOADING } from "./attachment-hydration.ts";
import type { QueryDataset } from "./dataset.ts";
import type { DatasetRun } from "./execution.ts";
import { matches as isMatch } from "./filter-evaluate.ts";
import { planFilter, planSubexpression } from "./filter-plan.ts";
import { projectColumns } from "./formulas.ts";
import { parentPathResolver, parentRootName } from "./parent-records.ts";
import { ANNOTATIONS } from "./query-annotations.ts";
import { ITEMS } from "./query-items.ts";
import { openRecordLoader } from "./record-loader.ts";
import type { ItemQueryRequest } from "./request.ts";

/** Attachment Query: one Attachment Row for each non-trashed Attachment. */
export const ATTACHMENTS: QueryDataset<ItemQueryRequest> = {
  id: "attachments",
  noun: "Attachment",
  family: "Attachment Query",
  customPrefix: `${attachmentFilterRegistry.prefix}.`,
  defaultFields: DEFAULT_ATTACHMENT_FIELDS,
  defaultSort: [{ field: "dateModified", direction: "desc" }],
  tieBreakers: [],
  get names() {
    return [
      ...ATTACHMENT_FIELDS.keys(),
      ...ATTACHMENT_PARENTS.flatMap((parent) => parent.names()),
    ];
  },
  lowerCandidate: lowerAttachmentCandidate,
  readCandidate: readAttachmentCandidateSet,
  readRowCount: readAttachmentRowCount,
  candidateParents: ATTACHMENT_PARENTS,
  candidateRelations: {
    item: {
      dataset: () => ITEMS,
      readChildren: ({ leaf, ...page }) =>
        readParentCandidateSet({ ...page, leaf, relation: "attachment-item" }),
    },
    annotations: {
      dataset: () => ANNOTATIONS,
      readParents: (chunk) =>
        readRelationCandidateSet({
          ...chunk,
          relation: "attachment-annotations",
        }),
    },
  },
  planSubexpression: (text, at, options) =>
    planSubexpression(text, at, {
      registry: attachmentFilterRegistry,
      ...options,
    }),
  sortableFields: ATTACHMENT_SORT_FIELDS,
  definition: attachmentFieldDefinition,
  filterField: (name) => attachmentFilterRegistry.field(name),
  planFilter: (text, context, formula) =>
    planFilter(text, { registry: attachmentFilterRegistry, context, formula }),
  sortable: attachmentSortableField,
  resolvePath: parentPathResolver(
    attachmentFieldDefinition,
    ATTACHMENT_PARENTS,
  ),
  rootName: (name) => parentRootName(name, ATTACHMENT_PARENTS),
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
