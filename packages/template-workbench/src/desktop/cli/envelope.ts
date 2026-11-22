import type { SchemaAsset } from "#core/cli/schema.ts";
import type { RenderTemplate } from "#core/cli/vocabulary.ts";

import type { ContractRoot } from "@zotlit/db";
import {
  engineFaultSpan,
  InertTemplateError,
} from "@zotlit/notes/core/template/errors.ts";
import type { EngineFaultSpan } from "@zotlit/notes/core/template/errors.ts";
import type { TemplateDataLoadResult } from "@zotlit/notes/desktop/template/data.ts";
import type { ResolvedLiteratureNoteProfileBindings } from "@zotlit/notes/obsidian/profile/bindings.ts";
import type { ProfileDiagnostic } from "@zotlit/notes/obsidian/profile/service.ts";
import type {
  CompileError,
  TemplateFileStatus,
} from "@zotlit/notes/obsidian/template/service.ts";
import {
  INVALID_ARGUMENT_HINT,
  createRenderedCliDiagnostics,
  lineColumn,
} from "@zotlit/obsidian-kit/cli-diagnostic.ts";
import type {
  FaultFacts,
  RenderedDiagnostic,
} from "@zotlit/obsidian-kit/cli-diagnostic.ts";
import { UNKNOWN_PROFILE_HINT } from "@zotlit/obsidian-kit/profile-stamp.ts";
import type { ProfileSelector } from "@zotlit/obsidian-kit/profile-stamp.ts";
import type {
  FrontmatterLanguage,
  FrontmatterMergeStrategy,
} from "@zotlit/templates/constants";
import { MissingTemplateError, TemplateError } from "@zotlit/templates/facade";
import type { TemplateLanguage } from "@zotlit/templates/facade";
import type { FrontmatterField } from "@zotlit/templates/frontmatter";

export const CONTRACT_VERSION = 8;

export interface WorkbenchIdentity {
  vault: {
    name: string;
    path: string;
  };
  source: {
    id: string | null;
    databasePath: string;
  };
}

export const DIAGNOSTIC_HINTS = {
  COMMAND_RETIRED:
    "Use ZotLit's legacy template conversion in settings, then edit the Template Document directly. Use template-inspect to select it, template-data for optional field discovery, and template-check to verify the result. Retained legacy records are managed by the conversion workflow.",
  INVALID_SELECTOR: INVALID_ARGUMENT_HINT,
  TARGET_MISMATCH:
    "Confirm the intended Zotero source with the user before you read or render again.",
  TEMPLATE_NOT_READY:
    "Run the command again after a short wait; when the message reports a failed start, ask the user to check the plugin log.",
  KEY_NOT_FOUND:
    "Select an Indexed Key that exists in the connected Zotero source.",
  NO_PARENT_ITEM:
    "Select the parent Item, or a child object that has a parent Item.",
  ANNOTATION_REQUIRED:
    "Select an Annotation key for the annotation root, or select another root.",
  ANNOTATION_ATTACHMENT_MISSING:
    "Open the Annotation in Zotero and confirm that its parent Attachment exists, then run the command again.",
  ETA_OPT_IN_REQUIRED:
    "Use a Liquid Template, or ask the user to enable JavaScript Templates in ZotLit settings.",
  TEMPLATE_COMPILE_ERROR:
    "Correct the syntax of the Template named in details.template, then render again.",
  TEMPLATE_RENDER_ERROR:
    "Read the message to find the failed expression, correct the Template or the selected object, then run the command again.",
  EXPRESSION_COMPILE_ERROR:
    "Correct the syntax of the expression named in expr, then evaluate it again.",
  RESERVED_KEY:
    "Choose a field key ZotLit does not manage; the reservedKeys list from frontmatter-status names every key that is off limits.",
  FIELD_NOT_FOUND:
    "Run frontmatter-status to see the configured keys, then use one of them.",
  DOCUMENT_NOT_FOUND:
    "Restore the referenced document, select another document, or provide a source override.",
  UNKNOWN_PROFILE_STAMP: UNKNOWN_PROFILE_HINT,
  DUPLICATE_MANAGED_BLOCK:
    "Keep at most one Managed Block in the document, then render it again.",
  MISSING_ANNOTATION_SECTION:
    "Add one standalone --- zotlit:annotation --- line after the note source. Its annotation source extends to EOF and can be empty; template-source template=annotation provides the built-in Liquid source.",
  DUPLICATE_ANNOTATION_SECTION:
    "Keep one --- zotlit:annotation --- header, followed by the annotation source through EOF.",
  UNKNOWN_SECTION_HEADER:
    "Use the exact standalone --- zotlit:annotation --- header. The note source starts after the manifest.",
  RESERVED_ANNOTATION_PARTIAL:
    "Rename the manifest partial named 'annotation' and update its calls. The Annotation Section supplies Profile annotation rendering.",
  DOCUMENT_INVALID:
    "Correct the document validation error, then inspect or render it again.",
  RESERVED_PARTIAL_NAME:
    "Rename the Shared Partial file to a name ZotLit does not already use. 'citation' names the Citation Template, and 'filename', 'note', 'annotation', and 'content' name the Literature Note Template slots.",
  MISSING_PARTIAL:
    "Create zotlit-partial.<name>.md in the template folder for the partial named in details.template, or correct the name the template calls.",
  BUNDLED_PARTIAL:
    "The partial named in details.template is still carried in a Profile document's manifest. Open that document in the Template Workbench and run Unpack partials, which writes zotlit-partial.<name>.md and clears the manifest entry.",
} as const satisfies Record<string, string>;

export type DiagnosticCode = keyof typeof DIAGNOSTIC_HINTS;

export interface Diagnostic extends RenderedDiagnostic<DiagnosticCode> {
  details?:
    | { parameter: string }
    | { target: "source"; expected: string; actual: string | null }
    | { key: string }
    | { template: string; line?: number; column?: number; context?: string };
}

const rendered = createRenderedCliDiagnostics<
  typeof DIAGNOSTIC_HINTS,
  Diagnostic["details"]
>(DIAGNOSTIC_HINTS, "INVALID_SELECTOR");

export function diagnostic(
  code: DiagnosticCode,
  message: string,
  details?: Diagnostic["details"],
): Diagnostic {
  return rendered.diagnostic(code, message, details);
}

export function faultDiagnostic(
  code: DiagnosticCode,
  message: string,
  facts: FaultFacts & { details?: Diagnostic["details"] },
): Diagnostic {
  return rendered.faultDiagnostic(code, message, facts);
}

export const { rejectionDiagnostic } = rendered;

export type WorkbenchCommand =
  | `zotlit:template-${
      | "status"
      | "data"
      | "schema"
      | "render"
      | "document-render"
      | "guide"
      | "source"}`
  | `zotlit:frontmatter-${"status" | "eval" | "set" | "remove" | "reorder"}`;

export type FrontmatterFieldRow = Pick<
  FrontmatterField,
  "key" | "expr" | "language" | "merge"
> & { inert: boolean };

export interface FrontmatterEvalRow {
  key: string;
  value?: unknown;
  source: "system" | "user";
  language: FrontmatterLanguage | null;
  merge: FrontmatterMergeStrategy | null;
  inert?: boolean;
  error?: { message: string };
}

export interface LiteratureNoteProfileRow {
  id: ProfileSelector;
  label: string;
  document: string | null;
  bindings?: ResolvedLiteratureNoteProfileBindings;
}

export interface LiteratureNoteDocumentRow {
  reference: string;
  path: string | null;
  validation:
    | {
        state: "valid";
        manifest: object;
        hasManagedBlock: boolean;
      }
    | { state: "invalid" | "missing"; diagnostic: Diagnostic };
}

interface EnvelopeFacts {
  request?: object;
  identity?: WorkbenchIdentity;
  template?: object;
  warnings?: readonly string[];
}

export type EnvelopeTail =
  | (EnvelopeFacts & { ok: false; diagnostic: Diagnostic })
  | (EnvelopeFacts & {
      ok: true;
      pluginVersion?: string;
      schemas?: Readonly<Record<ContractRoot, SchemaAsset>>;
      javascriptTemplatesEnabled?: boolean;
      templates?: readonly TemplateFileStatus[];
      profiles?: readonly LiteratureNoteProfileRow[];
      profileDiagnostics?: readonly ProfileDiagnostic[];
      documents?: readonly LiteratureNoteDocumentRow[];
      zt?: unknown;
      discovery?: object;
      markdown?: string;
      render?: { create: string; update: string | null };
      language?: TemplateLanguage;
      source?: string;
      fields?: readonly FrontmatterFieldRow[];
      reservedKeys?: readonly string[];
      entries?: readonly FrontmatterEvalRow[];
      value?: unknown;
      error?: { message: string };
    });

export function envelope(
  command: WorkbenchCommand,
  tail: EnvelopeTail,
): string {
  return json({ contractVersion: CONTRACT_VERSION, command, ...tail });
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function notSettledDiagnostic(timeoutMs: number): Diagnostic {
  return diagnostic(
    "TEMPLATE_NOT_READY",
    `Template compilation did not settle within ${timeoutMs} ms.`,
  );
}

export function initFailedDiagnostic(): Diagnostic {
  return diagnostic(
    "TEMPLATE_NOT_READY",
    "Template compilation failed to start; check the plugin log.",
  );
}

export function dataLoadDiagnostic(
  result: Exclude<TemplateDataLoadResult, { kind: "data" }>,
  key: string,
): Diagnostic {
  const code = {
    "not-found": "KEY_NOT_FOUND",
    "no-parent-item": "NO_PARENT_ITEM",
    "annotation-required": "ANNOTATION_REQUIRED",
    "annotation-attachment-missing": "ANNOTATION_ATTACHMENT_MISSING",
  } as const;
  return diagnostic(
    code[result.kind],
    result.kind === "not-found"
      ? `No Zotero object matches '${key}'.`
      : result.kind === "no-parent-item"
        ? `The Zotero object '${key}' has no parent Item.`
        : result.kind === "annotation-required"
          ? `The Zotero object '${key}' is not an Annotation.`
          : `The Annotation '${key}' has no parent Attachment row.`,
    { key },
  );
}

export function templateFaultDiagnostic(
  error: unknown,
  options: {
    template: RenderTemplate | null;
    compileErrors: ReadonlyMap<string, CompileError>;
  },
): Diagnostic {
  const message = error instanceof Error ? error.message : String(error);
  const named =
    error instanceof TemplateError || error instanceof InertTemplateError
      ? (error.templateName ?? options.template)
      : options.template;

  if (error instanceof InertTemplateError) {
    const details = named === null ? undefined : { template: named };
    return diagnostic("ETA_OPT_IN_REQUIRED", message, details);
  }

  if (error instanceof MissingTemplateError) {
    return missingPartialDiagnostic(error.templateName, message);
  }

  const compileError =
    named === null ? undefined : options.compileErrors.get(named);
  if (compileError !== undefined) {
    return sourceFaultDiagnostic("TEMPLATE_COMPILE_ERROR", {
      message: compileError.message,
      template: named,
      at: compileError.at,
      action: (where) => `Correct the syntax at ${where}, then render again.`,
    });
  }
  return sourceFaultDiagnostic("TEMPLATE_RENDER_ERROR", {
    message,
    template: named,
    at: engineFaultSpan(error),
    action: (where, found) =>
      `Correct ${JSON.stringify(found)} at ${where}, or the selected object, then run the command again.`,
  });
}

function sourceFaultDiagnostic(
  code: "TEMPLATE_COMPILE_ERROR" | "TEMPLATE_RENDER_ERROR",
  fault: {
    message: string;
    template: string | null;
    at: EngineFaultSpan | undefined;
    action: (where: string, found: string) => string;
  },
): Diagnostic {
  const { template, at } = fault;
  if (at === undefined) {
    return diagnostic(
      code,
      fault.message,
      template === null ? undefined : { template },
    );
  }
  const name = at.template ?? template ?? "template";
  const { line, column } = lineColumn(at.source, at.from);
  const found = at.source.slice(at.from, at.to);
  const message = fault.message.split("\n")[0]!.replace(/:$/, ".");
  const value = faultDiagnostic(code, message, {
    hint: fault.action(`${name}:${line}:${column}`, found),
    at: { source: at.source, span: { from: at.from, to: at.to }, name },
  });
  return {
    ...value,
    details: {
      template: template ?? name,
      line,
      column,
      context: value.report.slice(2, 4).join("\n"),
    },
  };
}

export function missingPartialDiagnostic(
  name: string,
  message: string,
): Diagnostic {
  return faultDiagnostic("MISSING_PARTIAL", message, {
    details: { template: name },
    hint: `Create zotlit-partial.${name}.md in the template folder, or correct the name '${name}' that the template calls.`,
  });
}
