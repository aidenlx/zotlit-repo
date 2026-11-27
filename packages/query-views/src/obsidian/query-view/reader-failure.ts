import type { DIAGNOSTIC_HINTS } from "#worker/item-query/contract.ts";
import type { QueryViewResult } from "#worker/item-query/query-view.ts";

import type { Diagnostic, ItemQueryErrorCode } from "@zotlit/item-query";
import { readerText } from "@zotlit/obsidian-kit/reader-diagnostic.ts";
import type { ReaderDiagnosticSource } from "@zotlit/obsidian-kit/reader-diagnostic.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

export interface LibraryRead {
  readonly state: "loading" | "ready" | "degraded";
  readonly dbFileMissing: boolean;
}

export type ViewFailureCode =
  | keyof typeof DIAGNOSTIC_HINTS
  | ItemQueryErrorCode
  | "query-failed"
  | "vault-filter-nested"
  | "vault-filter-mixed";

export type ViewDiagnostic = ReaderDiagnosticSource & {
  readonly code: ViewFailureCode;
  readonly location?: Diagnostic["location"];
  readonly found?: string;
};

const FAILURE_MESSAGES = {
  query_view_failure_library_loading: m.query_view_failure_library_loading,
  query_view_failure_library_unavailable:
    m.query_view_failure_library_unavailable,
  query_view_failure_database_missing: () =>
    m.query_view_failure_database_missing({
      view: m.library_view_name(),
      action: m.library_view_locate(),
    }),
  query_view_failure_read_error: m.query_view_failure_read_error,
  query_view_failure_layout: m.query_view_failure_layout,
  query_view_failure_no_library: m.query_view_failure_no_library,
  query_view_failure_library_not_found: m.query_view_failure_library_not_found,
  query_view_failure_too_large: m.query_view_failure_too_large,
  query_view_failure_internal: m.query_view_failure_internal,
} satisfies Record<string, () => string>;

type FailureMessageKey = keyof typeof FAILURE_MESSAGES;

export type ReaderFailure =
  | { readonly kind: "message"; readonly key: FailureMessageKey }
  | { readonly kind: "query-text" };

const message = (key: FailureMessageKey): ReaderFailure => ({
  kind: "message",
  key,
});

function sourceUnavailable(library: LibraryRead): FailureMessageKey {
  if (library.dbFileMissing) return "query_view_failure_database_missing";
  return library.state === "loading"
    ? "query_view_failure_library_loading"
    : "query_view_failure_library_unavailable";
}

export function readerFailure(
  code: ViewFailureCode,
  library: LibraryRead,
): ReaderFailure {
  switch (code) {
    case "source-unavailable":
      return message(sourceUnavailable(library));
    case "database-error":
      return message("query_view_failure_read_error");
    case "unsupported-database-layout":
      return message("query_view_failure_layout");
    case "no-library-available":
      return message("query_view_failure_no_library");
    case "library-not-found":
      return message("query_view_failure_library_not_found");
    case "result-too-large":
      return message("query_view_failure_too_large");
    case "export-unavailable":
    case "output-error":
    case "invalid-argument":
    case "query-id-in-use":
    case "query-failed":
      return message("query_view_failure_internal");
    case "duplicate-library":
    case "invalid-group":
    case "invalid-path":
    case "unknown-field":
    case "unknown-path":
    case "unsortable-field":
    case "invalid-limit":
    case "invalid-filter":
    case "unfilterable-field":
    case "unknown-function":
    case "unknown-property":
    case "wrong-argument-count":
    case "wrong-argument-type":
    case "wrong-operand-type":
    case "invalid-context":
    case "unbound-context":
    case "invalid-formula-name":
    case "invalid-formula-result":
    case "unknown-formula":
    case "formula-cycle":
    case "reads-faulted-formula":
    case "vault-filter-nested":
    case "vault-filter-mixed":
      return { kind: "query-text" };
    default:
      return code satisfies never;
  }
}

const SHELL_ARGUMENT = /\b[a-z][\w-]*='((?:[^']|'"'"')*)'/g;
const WHOLE_SHELL_ARGUMENT = /^[a-z][\w-]*='((?:[^']|'"'"')*)'$/;
const CORRECTION = "Try: ";
const COMMAND_LINE = /zotlit:|\b[a-z][\w-]*=(?:[<'"a-z])/;

function shellValue(raw: string): string {
  const value = raw.replaceAll(`'"'"'`, "'");
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return value;
    return parsed
      .map((entry: unknown) =>
        typeof entry === "string"
          ? entry
          : typeof entry === "object" &&
              entry !== null &&
              "field" in entry &&
              typeof entry.field === "string"
            ? entry.field
            : JSON.stringify(entry),
      )
      .join(", ");
  } catch {
    return value;
  }
}

function correctionForm(text: string): string {
  const shell = WHOLE_SHELL_ARGUMENT.exec(text);
  return shell ? shellValue(shell[1]!) : text;
}

function readerForm(text: string): string | null {
  if (text.startsWith(CORRECTION))
    return CORRECTION + correctionForm(text.slice(CORRECTION.length));
  const unwrapped = text.replaceAll(SHELL_ARGUMENT, (_whole, value: string) =>
    shellValue(value),
  );
  return COMMAND_LINE.test(unwrapped) ? null : unwrapped;
}

function readerHint(diagnostic: ViewDiagnostic): string {
  if (
    diagnostic.code === "unknown-formula" &&
    diagnostic.found &&
    diagnostic.expected?.length === 0 &&
    (diagnostic.suggestions ?? []).length === 0
  )
    return m.query_view_failure_formula_undefined({
      name: diagnostic.found,
      add: m.query_view_formula_add(),
    });
  return readerForm(diagnostic.hint) ?? "";
}

export function readerSource(
  diagnostic: ViewDiagnostic,
  library: LibraryRead,
): ReaderDiagnosticSource | string {
  const failure = readerFailure(diagnostic.code, library);
  if (failure.kind === "message") return FAILURE_MESSAGES[failure.key]();
  return {
    ...diagnostic,
    hint: readerHint(diagnostic),
    suggestions: [
      ...new Set((diagnostic.suggestions ?? []).map(correctionForm)),
    ],
  };
}

export function sourceText(source: ReaderDiagnosticSource | string): string {
  return typeof source === "string" ? source : readerText(source);
}

export function readerFailureText(
  diagnostic: ViewDiagnostic,
  library: LibraryRead,
): string {
  return sourceText(readerSource(diagnostic, library));
}

export interface ViewWarning {
  readonly code: QueryViewResult["warnings"][number]["code"];
  readonly message: string;
  readonly found: string;
}

export function readerWarningText(warning: ViewWarning): string {
  switch (warning.code) {
    case "key-outside-target-libraries":
      return m.query_view_warning_outside_library_scope();
    case "unknown-collection":
      return m.query_view_warning_unknown_collection({ path: warning.found });
    case "never-true":
    case "always-true":
    case "unused-formula":
      return warning.message;
    default:
      return warning.code satisfies never;
  }
}
