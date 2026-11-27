import {
  ATTACHMENT_FIELDS,
  ATTACHMENT_PARENTS,
  ATTACHMENT_SORT_FIELDS,
  attachmentFieldDefinition,
  attachmentFilterRegistry,
  attachmentSortableField,
  DEFAULT_ATTACHMENT_FIELDS,
} from "./attachment-fields.ts";
import type { QueryDataset } from "./dataset.ts";
import { planFilter, planSubexpression } from "./filter-plan.ts";
import { parentPathResolver, parentRootName } from "./parent-records.ts";

export const ATTACHMENTS: QueryDataset = {
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
};
