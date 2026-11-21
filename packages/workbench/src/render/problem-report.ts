// The error report of a document the parser refuses: a failure with no engine
// behind it, reported through the same record and the same text as a render's.

import type { WorkbenchProblem } from "#document/controller.ts";

import type {
  RenderReport,
  WorkbenchReportContext,
} from "@zotlit/notes/core/template/render-report.ts";
import { engineEvidence } from "@zotlit/notes/core/template/render-report.ts";

import { templateSourceRevision } from "#render/result.ts";

/**
 * The report one document problem carries. The parser found it in the source
 * this Workbench holds rather than in a render. When the parser supplied an
 * exception, its message and chain are captured; fields it cannot fill — name,
 * excerpt, engine location, caller, repair target, attempt number — are absent
 * and reported as unavailable. Every value is read once, at capture, the same
 * as a render report's.
 */
export function captureProblemReport({
  problem,
  message,
  source,
  capturedAt,
  context,
}: {
  readonly problem: WorkbenchProblem;
  /** The problem's own condition, in the language the reader is reading. */
  readonly message: string;
  /** The document text it was found in, which stamps the source revision. */
  readonly source: string;
  readonly capturedAt: string;
  readonly context: WorkbenchReportContext;
}): RenderReport {
  const { range } = problem;
  const evidence =
    problem.error === undefined ? { message } : engineEvidence(problem.error);
  const reportedLocation =
    range === undefined ? undefined : `offset ${range.from}-${range.to}`;
  return {
    code: problem.code,
    evidence: {
      ...evidence,
      ...(evidence.reportedLocation === undefined &&
      reportedLocation !== undefined
        ? { reportedLocation }
        : {}),
    },
    section: problem.slice,
    capturedAt,
    // The parser reads the document on every change; no deliberate Run of the
    // reader's own reached this problem.
    trigger: "automatic",
    identity: {
      sourceRevision: templateSourceRevision(source),
      // No render ran, so no paper was ever read for this one.
      snapshotRevision: "",
    },
    context,
  };
}
