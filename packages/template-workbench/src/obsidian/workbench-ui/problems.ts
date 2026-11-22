import type {
  WorkbenchProblem,
  WorkbenchSliceId,
} from "#core/document/controller.ts";
import type { RenderDiagnostic } from "#core/render/result.ts";

import type { RenderReport } from "@zotlit/notes/core/template/render-report.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import { entryPosition } from "#core/document/controller.ts";

export interface ProblemText {
  readonly message: string;
  readonly recovery?: string;
}

export function problemText(problem: WorkbenchProblem): ProblemText {
  switch (problem.code) {
    case "invalid-document":
      return {
        message: m.workbench_problem_invalid_document(),
        recovery: m.workbench_problem_invalid_document_recovery(),
      };
    case "invalid-manifest":
      return {
        message:
          problem.params?.field === undefined
            ? m.workbench_problem_invalid_manifest()
            : m.workbench_problem_invalid_manifest_field({
                field: problem.params.field,
              }),
        recovery: m.workbench_problem_invalid_manifest_recovery(),
      };
    case "invalid-managed-block":
      return {
        message: m.workbench_problem_invalid_managed_block(),
        recovery: m.workbench_problem_invalid_managed_block_recovery(),
      };
    case "duplicate-managed-block":
      return {
        message: m.workbench_problem_duplicate_managed_block(),
        recovery: m.workbench_problem_duplicate_managed_block_recovery(),
      };
    case "unknown-section-header":
      return {
        message: m.workbench_problem_unknown_section_header(),
        recovery: m.workbench_problem_unknown_section_header_recovery(),
      };
    case "duplicate-annotation-section":
      return {
        message: m.workbench_problem_duplicate_annotation_section(),
        recovery: m.workbench_problem_duplicate_annotation_section_recovery(),
      };
    case "missing-annotation-section":
      return {
        message: m.workbench_problem_missing_annotation_section(),
        recovery: m.workbench_problem_missing_annotation_section_recovery(),
      };
    case "reserved-annotation-partial":
      return {
        message: m.workbench_problem_reserved_annotation_partial(),
        recovery: m.workbench_problem_reserved_annotation_partial_recovery(),
      };
    case "bundled-partial":
      return {
        message: m.workbench_problem_bundled_partial({
          names: String(problem.params?.names),
        }),
        recovery: m.workbench_problem_bundled_partial_recovery(),
      };
  }
}

export function diagnosticText(diagnostic: RenderDiagnostic): string {
  const params = diagnostic.params ?? {};
  switch (diagnostic.code) {
    case "contract-version-mismatch":
      return m.workbench_diagnostic_contract_mismatch({
        found: String(params.found),
        expected: String(params.expected),
      });
    case "property-error":
      return m.workbench_diagnostic_property_error({
        key: String(params.key),
        message: String(params.detail ?? diagnostic.message ?? ""),
      });
    case "property-javascript":
      return params.key === undefined
        ? m.workbench_diagnostic_property_javascript_unnamed({
            position: String(diagnostic.position),
          })
        : m.workbench_diagnostic_property_javascript({
            key: String(params.key),
          });
    case "missing-partial":
      return m.workbench_diagnostic_missing_partial({
        name: String(params.name),
      });
    case "citation-data-mismatch":
      return m.workbench_diagnostic_citation_data_mismatch();
    case "property-append-conflict": {
      const conflict = m.workbench_diagnostic_property_append_conflict({
        key: String(params.key),
      });
      return diagnostic.message
        ? `${conflict} ${diagnostic.message}`
        : conflict;
    }
    case "liquid-syntax-error":
      return m.workbench_diagnostic_liquid_syntax_error();
    case "render-error":
      return m.workbench_diagnostic_render_error();
    default:
      return diagnostic.message ?? diagnostic.code;
  }
}

const PROBLEM_WHERE: Partial<Record<WorkbenchSliceId, () => string>> = {
  advanced: m.workbench_problems_where_advanced,
  note: m.workbench_problems_where_note,
  filename: m.workbench_problems_where_filename,
  details: m.workbench_problems_where_details,
  annotation: m.workbench_annotation_label,
};

export function problemWhere(problem: WorkbenchProblem): string {
  if (problem.code === "missing-annotation-section") {
    return m.workbench_annotation_label();
  }
  if (entryPosition(problem.slice) !== null) {
    return m.workbench_problems_where_entry();
  }
  return (
    PROBLEM_WHERE[problem.slice] ?? m.workbench_problems_where_advanced
  )();
}

export type WorkbenchDiagnosis =
  | {
      readonly id: string;
      readonly kind: "document";
      readonly problem: WorkbenchProblem;
      readonly occurrences: readonly WorkbenchProblem[];
    }
  | {
      readonly id: string;
      readonly kind: "render";
      readonly diagnostic: RenderDiagnostic;
      readonly occurrences: readonly RenderDiagnostic[];
    };

const unattributedOccurrenceIds = new WeakMap<RenderDiagnostic, string>();
let nextUnattributedId = 0;

function diagnosticSubject(diagnostic: RenderDiagnostic): string {
  const params = diagnostic.params ?? {};
  return String(
    params.name ??
      params.key ??
      params.styleId ??
      diagnostic.engine?.template ??
      "",
  );
}

function problemSubject(problem: WorkbenchProblem): string {
  const params = problem.params ?? {};
  return String(
    params.section ??
      params.field ??
      params.key ??
      params.name ??
      params.names ??
      "",
  );
}

function repairTarget(diagnostic: RenderDiagnostic): string | undefined {
  if (diagnostic.sourceSite !== undefined) {
    const { source, from, to, offset } = diagnostic.sourceSite;
    return `source:${source.slice(from - offset, to - offset)}`;
  }
  if (
    diagnostic.code === "missing-partial" &&
    diagnostic.params?.name !== undefined
  )
    return `partial:${diagnostic.params.name}`;
  const identity = diagnostic.callIdentity;
  if (identity !== undefined) return `call:${identity}`;
  if (diagnostic.callSite !== undefined) {
    return `call:${diagnostic.callSite.from}:${diagnostic.callSite.to}`;
  }
  if (diagnostic.position !== undefined) return `entry:${diagnostic.position}`;
  if (diagnostic.code === "citation-style-error") return "citation-style";
  if (diagnostic.part === "annotation") return "annotation";
  if (diagnostic.part === "filename") return "filename";
  return undefined;
}

function unattributedOccurrenceIdentity(diagnostic: RenderDiagnostic): string {
  const kept = unattributedOccurrenceIds.get(diagnostic);
  if (kept !== undefined) return kept;
  const id = `occurrence:${nextUnattributedId++}`;
  unattributedOccurrenceIds.set(diagnostic, id);
  return id;
}

export function documentDiagnosis(
  problem: WorkbenchProblem,
): WorkbenchDiagnosis {
  return {
    id: `document:${problem.code}:${problemSubject(problem)}:${problem.slice}`,
    kind: "document",
    problem,
    occurrences: [problem],
  };
}

export function renderDiagnosis(
  diagnostic: RenderDiagnostic,
): WorkbenchDiagnosis {
  const { code, part, position, engine, evidence } = diagnostic;
  const subject = diagnosticSubject(diagnostic);
  const target = repairTarget(diagnostic);
  const cause =
    code === "render-error" || code === "liquid-syntax-error"
      ? engine?.line !== undefined && evidence !== undefined
        ? [
            engine.template,
            engine.line,
            engine.column,
            evidence.name,
            evidence.message,
            evidence.causes,
          ]
        : undefined
      : code;
  const identity =
    subject !== "" && target !== undefined && cause !== undefined
      ? JSON.stringify([code, subject, part, position, target, cause])
      : unattributedOccurrenceIdentity(diagnostic);
  return {
    id: `render:${identity}`,
    kind: "render",
    diagnostic,
    occurrences: [diagnostic],
  };
}

export function workbenchDiagnoses(
  problems: readonly WorkbenchProblem[],
  diagnostics: readonly RenderDiagnostic[],
): WorkbenchDiagnosis[] {
  const found = [
    ...problems.map(documentDiagnosis),
    ...diagnostics.map(renderDiagnosis),
  ];
  return [...Map.groupBy(found, (diagnosis) => diagnosis.id).values()].map(
    (occurrences) =>
      ({
        ...occurrences[0]!,
        occurrences: occurrences.flatMap<RenderDiagnostic | WorkbenchProblem>(
          (diagnosis) => diagnosis.occurrences,
        ),
      }) as WorkbenchDiagnosis,
  );
}

export function diagnosisForOccurrence(
  diagnosis: WorkbenchDiagnosis,
  occurrence: RenderDiagnostic,
): WorkbenchDiagnosis {
  if (
    diagnosis.kind !== "render" ||
    !diagnosis.occurrences.includes(occurrence)
  )
    return diagnosis;
  return { ...diagnosis, diagnostic: occurrence };
}

export interface DiagnosisExplanation {
  readonly object: string;
  readonly condition: string;
  readonly suggestion: string;
  readonly evidence?: string;
}

function problemObject(problem: WorkbenchProblem): string {
  if (problem.code === "missing-annotation-section") {
    return m.workbench_annotation_label();
  }
  if (entryPosition(problem.slice) !== null)
    return m.workbench_tab_properties();
  switch (problem.slice) {
    case "note":
      return m.workbench_tab_note();
    case "annotation":
      return m.workbench_annotation_label();
    case "filename":
      return m.workbench_name_filename_heading();
    case "details":
      return m.workbench_tab_profile();
    default:
      return m.workbench_advanced();
  }
}

function diagnosticObject(diagnostic: RenderDiagnostic): string {
  const params = diagnostic.params ?? {};
  switch (diagnostic.code) {
    case "missing-partial":
      return m.workbench_problems_object_partial({ name: String(params.name) });
    case "citation-data-mismatch":
      return m.workbench_problems_object_citation();
    case "property-error":
    case "property-append-conflict":
      return m.workbench_problems_object_property({ key: String(params.key) });
    case "property-javascript":
      return params.key === undefined
        ? m.workbench_tab_properties()
        : m.workbench_problems_object_property({ key: String(params.key) });
    case "citation-style-error":
      return params.styleId === undefined
        ? m.workbench_problems_object_citation()
        : m.workbench_problems_object_style({
            styleId: String(params.styleId),
          });
    case "contract-version-mismatch":
    case "invalid-profile":
      return m.workbench_problems_object_profile();
    default: {
      if (diagnostic.part === "annotation")
        return m.workbench_annotation_label();
      if (diagnostic.part === "filename")
        return m.workbench_name_filename_heading();
      switch (diagnostic.report?.context.root) {
        case "annotation":
          return m.workbench_annotation_label();
        case "citation":
          return m.workbench_problems_object_citation();
        case "note":
          return m.workbench_tab_note();
        case "partial":
          return m.workbench_tab_partial();
      }
      return diagnostic.position !== undefined
        ? m.workbench_tab_properties()
        : m.workbench_problems_object_profile();
    }
  }
}

function diagnosticSuggestion(diagnostic: RenderDiagnostic): string {
  switch (diagnostic.code) {
    case "liquid-syntax-error":
      return diagnostic.params?.tag === "for"
        ? m.workbench_diagnostic_liquid_for_suggestion()
        : m.workbench_diagnostic_liquid_syntax_error_suggestion();
    case "missing-partial":
      return m.workbench_diagnostic_missing_partial_suggestion();
    case "citation-data-mismatch":
      return m.workbench_diagnostic_citation_data_suggestion();
    case "property-error":
      return m.workbench_diagnostic_property_error_suggestion();
    case "property-javascript":
      return m.workbench_diagnostic_property_javascript_suggestion();
    case "property-append-conflict":
      return m.workbench_diagnostic_property_append_conflict_suggestion();
    case "citation-style-error":
      return m.workbench_diagnostic_citation_style_suggestion();
    case "contract-version-mismatch":
      return m.workbench_diagnostic_contract_mismatch_suggestion();
    case "invalid-profile":
      return m.workbench_diagnostic_invalid_profile_suggestion();
    default:
      return m.workbench_diagnostic_render_error_suggestion();
  }
}

export function diagnosisExplanation(
  diagnosis: WorkbenchDiagnosis,
): DiagnosisExplanation {
  if (diagnosis.kind === "document") {
    const text = problemText(diagnosis.problem);
    return {
      object: problemObject(diagnosis.problem),
      condition: text.message,
      suggestion:
        text.recovery ?? m.workbench_diagnostic_render_error_suggestion(),
    };
  }
  const { diagnostic } = diagnosis;
  return {
    object: diagnosticObject(diagnostic),
    condition:
      (diagnostic.code === "render-error"
        ? (
            diagnostic.evidence?.message ??
            diagnostic.report?.evidence?.message ??
            diagnostic.message
          )
            ?.trim()
            .split("\n", 1)[0]
        : undefined) || diagnosticText(diagnostic),
    suggestion: diagnosticSuggestion(diagnostic),
    // oxlint-disable-next-line zotlit-errors/no-message-match -- the diagnostic's own text field, not an error's message.
    ...(diagnostic.message === undefined
      ? {}
      : { evidence: diagnostic.message }),
  };
}

export function diagnosisWhere(diagnosis: WorkbenchDiagnosis): string {
  if (diagnosis.kind === "document") return problemWhere(diagnosis.problem);
  const { part, position, callSite, sourceSite } = diagnosis.diagnostic;
  if (sourceSite) return m.workbench_problems_highlight_error();
  if (callSite) return m.workbench_problems_where_call();
  if (position !== undefined) return m.workbench_problems_where_entry();
  if (part === "annotation") return m.workbench_annotation_edit_format();
  if (part === "filename") return m.workbench_problems_where_filename();
  return m.workbench_problems_where_advanced();
}

export function diagnosisEngineSources(
  diagnosis: WorkbenchDiagnosis,
): string[] {
  if (diagnosis.kind === "document") return [];
  const said = new Set<string>();
  for (const { engine } of diagnosis.occurrences) {
    if (!engine) continue;
    said.add(
      engine.line === undefined
        ? m.workbench_problems_engine_source({ template: engine.template })
        : m.workbench_problems_engine_source_line({
            template: engine.template,
            line: engine.line,
          }),
    );
  }
  return [...said];
}

export function diagnosisLabel(diagnosis: WorkbenchDiagnosis): string {
  return diagnosisExplanation(diagnosis).object;
}

export function diagnosisReport(
  diagnosis: WorkbenchDiagnosis,
): RenderReport | null {
  return diagnosis.kind === "render"
    ? (diagnosis.diagnostic.report ?? null)
    : null;
}

export function diagnosisLocated(diagnosis: WorkbenchDiagnosis): boolean {
  return diagnosis.kind === "document"
    ? diagnosis.problem.range !== undefined
    : diagnosis.diagnostic.sourceSite !== undefined ||
        diagnosis.diagnostic.callSite !== undefined ||
        diagnosis.diagnostic.sliceSite !== undefined ||
        diagnosis.diagnostic.position !== undefined ||
        diagnosis.diagnostic.part === "annotation" ||
        diagnosis.diagnostic.part === "filename";
}
