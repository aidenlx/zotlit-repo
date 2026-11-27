import { fieldRoot } from "./dataset.ts";
import type { QueryDataset } from "./dataset.ts";
import {
  BUILT_IN_NAMES,
  DEFAULT_FIELDS,
  fieldDefinition,
  filterField,
} from "./fields.ts";
import { planFilter, planSubexpression } from "./filter-plan.ts";
import { resolveItemPath } from "./projection.ts";

const sortable = (name: string) => {
  const definition = fieldDefinition(name);
  return definition?.sortKey
    ? { needs: definition.needs([]), key: definition.sortKey }
    : undefined;
};

export const ITEMS: QueryDataset = {
  id: "items",
  noun: "Item",
  family: "Item Query",
  customPrefix: "",
  defaultFields: DEFAULT_FIELDS,
  defaultSort: [{ field: "dateModified", direction: "desc" }],
  tieBreakers: [],
  names: BUILT_IN_NAMES,
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
};
