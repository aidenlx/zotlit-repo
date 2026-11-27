import type { CliFlag, CliFlags } from "obsidian";

import type { QueryParam, QueryValuesParam } from "./decode.ts";

import {
  DEFAULT_CLI_LIMIT,
  QUERY_CANCEL_COMMAND,
  QUERY_COMMAND,
  QUERY_ID_FORM,
} from "#worker/item-query/contract.ts";

export const queryFlags = {
  from: {
    value: "<items|attachments|annotations>",
    description: "Query Dataset to read (default: items)",
  },
  filter: {
    value: "<expression>",
    description:
      "Filter Expression that selects rows; omit it to match every row in the dataset",
  },
  fields: {
    value: "<list|json>",
    description:
      "Comma list or JSON array of Projection Paths, such as title,date.year; [] returns only row identities",
  },
  formulas: {
    value: "<json>",
    description:
      'JSON object of Formulas: each name with a Filter Expression, such as {"year":"date.year"}; read one as formula.<name> in fields',
  },
  sort: {
    value: "<list|json>",
    description:
      'Comma list: -field descending, +field or field ascending; or a JSON array of {"field","direction"}',
  },
  group: {
    value: "<path>",
    description:
      "Group by one scalar Projection Path, or by each element value with one [] (tags[].name); limit applies inside each group",
  },
  limit: {
    value: "<n|all>",
    description: `Most rows to return: a positive integer, or all (default ${DEFAULT_CLI_LIMIT})`,
  },
  library: {
    value: "<list|all>",
    description:
      "Target Libraries: personal, group:<groupID>, a comma list or JSON array, or all (default: Library scope)",
  },
  output: {
    value: "<absolute-path>",
    description:
      "Write the complete response to a new file in the given format and return its path and counts",
  },
  format: {
    value: "<json|csv|tsv>",
    description:
      "Format of the output file: the JSON response, or one CSV or TSV line for each row (default: json); csv and tsv need output",
  },
  id: {
    value: "<id>",
    description: `Name this query so that ${QUERY_CANCEL_COMMAND} can stop it: ${QUERY_ID_FORM}`,
  },
  "this-item": {
    value: "<indexed-key>",
    description:
      "Bind this.item to the Item with this Indexed Key; a filter reads it, as in item == this.item",
  },
  "this-attachment": {
    value: "<indexed-key>",
    description:
      "Bind this.attachment to the Attachment with this Indexed Key, as in attachment == this.attachment",
  },
} satisfies Record<QueryParam, CliFlag>;

export const queryValuesFlags = {
  kind: {
    value: "<collections|tags>",
    description: "Values to list",
    required: true,
  },
  library: {
    value: "<selector|all>",
    description:
      "One Library: personal or group:<groupID>, or all (default: Library scope)",
  },
  match: {
    value: "<text>",
    description: "Keep values that contain this text, ignoring letter case",
  },
  limit: {
    value: "<n|all>",
    description: `Most values per Library: a positive integer, or all (default ${DEFAULT_CLI_LIMIT})`,
  },
} satisfies Record<QueryValuesParam, CliFlag>;

export const queryCancelFlags: CliFlags = {
  id: {
    value: "<id>",
    description: `The id of a running ${QUERY_COMMAND} call in this vault`,
  },
} satisfies Record<"id", CliFlag>;
