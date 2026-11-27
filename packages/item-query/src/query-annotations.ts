import {
  ANNOTATION_FIELDS,
  ANNOTATION_PARENTS,
  ANNOTATION_SORT_FIELDS,
  annotationFieldDefinition,
  annotationFilterRegistry,
  annotationSortableField,
  DEFAULT_ANNOTATION_FIELDS,
} from "./annotation-fields.ts";
import type { QueryDataset } from "./dataset.ts";
import { planFilter, planSubexpression } from "./filter-plan.ts";
import { parentPathResolver, parentRootName } from "./parent-records.ts";

export const ANNOTATIONS: QueryDataset = {
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
};
