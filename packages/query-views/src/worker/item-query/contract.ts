import type {
  DecodeFault,
  Diagnostic as QueryDiagnostic,
  ItemQueryError,
  QuerySummary,
  QueryGroup,
  SchemaCustomField,
  SortSpec,
} from "@zotlit/item-query";
import { renderDiagnostic } from "@zotlit/item-query";
import {
  INVALID_ARGUMENT_HINT,
  SOURCE_UNAVAILABLE_HINT,
  createRenderedCliDiagnostics,
} from "@zotlit/obsidian-kit/worker/cli-diagnostic.ts";
import type { SchemaAsset } from "@zotlit/template-workbench/worker/cli/schema-asset.ts";
import type { WorkbenchIdentity } from "@zotlit/template-workbench/worker/cli/workbench-identity.ts";
import { QUERY_EXPORT_FORMATS } from "@zotlit/zotero-reads/contract/query-codec.ts";
import type { SourceIdentity } from "@zotlit/zotero-reads/contract/source-identity.ts";

import contractVersion from "./contract-version.json" with { type: "json" };

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
export const QUERY_OUTPUT_FORMATS = QUERY_EXPORT_FORMATS;
export type QueryOutputFormat = (typeof QUERY_OUTPUT_FORMATS)[number];
export const QUERY_ID_MAX_LENGTH = 128;
export const QUERY_ID_FORM = `1 to ${QUERY_ID_MAX_LENGTH} ASCII letters, digits, ., _, or -`;

export function queryCancelledText(id: string): string {
  return `The query '${id}' was cancelled by ${QUERY_CANCEL_COMMAND}.`;
}

export const DIAGNOSTIC_HINTS = {
  "result-too-large":
    "Run the query with output=<absolute-path> to write the complete response to a new JSON file, or reduce the fields or limit.",
  "export-unavailable":
    "Run the query again without output and format to get the answer inline, and reduce the fields or the limit until the answer fits the inline limit.",
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

export const RESULT_TOO_LARGE_HINTS = {
  [QUERY_VALUES_COMMAND]:
    "Narrow match or reduce limit in zotlit:query-values, then run it again.",
  [QUERY_SCHEMA_COMMAND]:
    "Run zotlit:query-schema with from=<items|attachments|annotations> to describe one Query Dataset.",
} as const satisfies Partial<Record<QueryCliCommand, string>>;

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

export function deliveryDiagnostic(
  code: "result-too-large" | "output-error" | "export-unavailable",
  message: string,
  commandName: QueryCliCommand,
): Diagnostic {
  if (code === "export-unavailable")
    return diagnostic(code, message, { parameter: "output" });
  const hint =
    code === "result-too-large" &&
    Object.hasOwn(RESULT_TOO_LARGE_HINTS, commandName)
      ? RESULT_TOO_LARGE_HINTS[
          commandName as keyof typeof RESULT_TOO_LARGE_HINTS
        ]
      : undefined;
  return hint === undefined
    ? diagnostic(code, message)
    : renderDiagnostic({ ...diagnostic(code, message), hint });
}

export function rejectionDiagnostic(rejection: DecodeFault): Diagnostic {
  return base.rejectionDiagnostic(rejection);
}

export interface QueryIdentity {
  vault: WorkbenchIdentity["vault"];
  source: SourceIdentity;
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
      identity: QueryIdentity;
      libraries: readonly LibraryWire[];
      request: object;
      returnedCount: number;
      truncated: boolean;
      values: readonly LibraryValues[];
    }
  | { ok: false; diagnostic: Diagnostic }
  | {
      ok: true;
      identity: QueryIdentity;
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
      identity: QueryIdentity;
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
  return serialize(command, tail);
}

export function fileReceipt(
  command: QueryCliCommand,
  summary: { readonly ok: true } & Readonly<Record<string, unknown>>,
  file: { path: string; bytes: number; format: QueryOutputFormat },
): string {
  return serialize(command, { ...summary, file });
}

function serialize(command: QueryCliCommand, tail: object): string {
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
