import type { CliFlag, CliFlags } from "obsidian";

import type {
  Diagnostic as QueryDiagnostic,
  ItemQueryError,
  QuerySummary,
  QueryGroup,
  SchemaCustomField,
  SortSpec,
} from "@zotlit/item-query";
import {
  INVALID_ARGUMENT_HINT,
  SOURCE_UNAVAILABLE_HINT,
  createRenderedCliDiagnostics,
} from "@zotlit/obsidian-kit/cli-diagnostic.ts";
import type { CliRejection } from "@zotlit/obsidian-kit/cli-params.ts";
import { DELIMITED_FORMATS } from "@zotlit/shared/delimited";
import type { SchemaAsset } from "@zotlit/template-workbench/core/cli/schema.ts";
import type { WorkbenchIdentity } from "@zotlit/template-workbench/desktop/cli/envelope.ts";

import contractVersion from "./contract-version.json" with { type: "json" };
import type { QueryParam, QueryValuesParam } from "./decode.ts";

export const CONTRACT_VERSION = contractVersion.contractVersion;

export const QUERY_COMMAND = "zotlit:query" as const;
export const QUERY_CANCEL_COMMAND = "zotlit:query-cancel" as const;
export const QUERY_VALUES_COMMAND = "zotlit:query-values" as const;
export const QUERY_SCHEMA_COMMAND = "zotlit:query-schema" as const;
export const QUERY_GUIDE_COMMAND = "zotlit:query-guide" as const;

export type QueryCliCommand =
  | typeof QUERY_COMMAND
  | typeof QUERY_VALUES_COMMAND
  | typeof QUERY_CANCEL_COMMAND
  | typeof QUERY_SCHEMA_COMMAND
  | typeof QUERY_GUIDE_COMMAND;

export const DEFAULT_CLI_LIMIT = 100;
export const INLINE_MAX_BYTES = 1024 * 1024;
export const QUERY_OUTPUT_FORMATS = ["json", ...DELIMITED_FORMATS] as const;
export type QueryOutputFormat = (typeof QUERY_OUTPUT_FORMATS)[number];
export const QUERY_ID_MAX_LENGTH = 128;
export const QUERY_ID_FORM = `1 to ${QUERY_ID_MAX_LENGTH} ASCII letters, digits, ., _, or -`;

export function queryCancelledText(id: string): string {
  return `The query '${id}' was cancelled by ${QUERY_CANCEL_COMMAND}.`;
}

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

export const DIAGNOSTIC_HINTS = {
  "result-too-large":
    "Run the query with output=<absolute-path> to write the complete response to a new JSON file, or reduce the fields or limit.",
  "output-error":
    "Use an absolute output path in an existing writable directory, with a filename that does not exist.",
  "invalid-argument": INVALID_ARGUMENT_HINT,
  "query-id-in-use": `Give this query another id. A query with this id is still running in this vault; the id is free again when that query finishes or is cancelled with ${QUERY_CANCEL_COMMAND}.`,
  "source-unavailable": SOURCE_UNAVAILABLE_HINT,
  "library-not-found":
    "Use personal, or group:<groupID> with the group ID of a group Library that the connected Zotero source holds; library=all reads every Library of the source.",
  "no-library-available":
    "Name the Libraries with library=<list> or use library=all; to change the default, ask the user to select an available Library in the Library scope setting of ZotLit.",
  "database-error":
    "Run the command again; if it fails again, ask the user to check the plugin log.",
  "unsupported-database-layout":
    "Ask the user to update ZotLit: this ZotLit version cannot read the way their Zotero version stores its data. Running the command again gives the same result until then.",
} as const satisfies Record<string, string>;

type AdapterDiagnosticCode = keyof typeof DIAGNOSTIC_HINTS;

export interface Diagnostic extends QueryDiagnostic<
  AdapterDiagnosticCode | ItemQueryError["code"]
> {
  details?: { parameter: string };
}

const base = createRenderedCliDiagnostics<
  typeof DIAGNOSTIC_HINTS,
  Diagnostic["details"]
>(DIAGNOSTIC_HINTS, "invalid-argument");

export function diagnostic(
  code: AdapterDiagnosticCode,
  message: string,
  details?: Diagnostic["details"],
): Diagnostic {
  return base.diagnostic(code, message, details);
}

export function rejectionDiagnostic(rejection: CliRejection): Diagnostic {
  return base.rejectionDiagnostic(rejection);
}

export type LibraryWire =
  | { type: "personal" }
  | { type: "group"; groupID: number; name: string };

export interface LibraryValues {
  library: string;
  name: string;
  totalCount: number;
  returnedCount: number;
  truncated: boolean;
  values: readonly (string | { name: string; type: string })[];
}

export type EnvelopeTail =
  | {
      ok: true;
      identity: WorkbenchIdentity;
      libraries: readonly LibraryWire[];
      request: object;
      returnedCount: number;
      truncated: boolean;
      values: readonly LibraryValues[];
    }
  | { ok: false; diagnostic: Diagnostic }
  | {
      ok: true;
      identity: WorkbenchIdentity;
      libraries: readonly LibraryWire[];
      request: object;
      returnedCount: number;
      totalCount?: number;
      groups?: readonly QueryGroup[];
      truncated: boolean;
      warnings: QuerySummary["warnings"];
      rows?: readonly { indexedKey: string; values: object }[];
      file?: { path: string; bytes: number; format: QueryOutputFormat };
    }
  | {
      ok: true;
      identity: WorkbenchIdentity;
      schema: SchemaAsset;
      customFields: readonly SchemaCustomField[];
      datasets: Partial<
        Record<
          "items" | "annotations",
          { fields: readonly string[]; customPrefix: string }
        >
      >;
      defaults: Partial<
        Record<
          "items" | "annotations",
          {
            fields: readonly string[];
            sort: readonly SortSpec[];
            limit: number;
            library: { source: "library-scope" };
          }
        >
      >;
    }
  | {
      ok: true;
      id: string;
      cancelRequested: boolean;
    };

export function envelope(command: QueryCliCommand, tail: EnvelopeTail): string {
  return JSON.stringify(
    { contractVersion: CONTRACT_VERSION, command, ...tail },
    null,
    2,
  );
}

export function failure(
  command: QueryCliCommand,
  diagnostic: Diagnostic,
): string {
  return envelope(command, { ok: false, diagnostic });
}

export function queryIdInUseFailure(
  id: string,
  command: QueryCliCommand,
): string {
  return failure(
    command,
    diagnostic(
      "query-id-in-use",
      `A query with the id '${id}' is running in this vault.`,
      { parameter: "id" },
    ),
  );
}
