import type { WorkbenchProblem } from "#core/document/controller.ts";

import type {
  RenderReport,
  WorkbenchReportContext,
} from "@zotlit/notes/core/template/render-report.ts";
import { engineEvidence } from "@zotlit/notes/core/template/render-report.ts";

import { templateSourceRevision } from "#core/render/result.ts";

export function captureProblemReport({
  problem,
  message,
  source,
  capturedAt,
  context,
}: {
  readonly problem: WorkbenchProblem;
  readonly message: string;
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
    trigger: "automatic",
    identity: {
      sourceRevision: templateSourceRevision(source),
      snapshotRevision: "",
    },
    context,
  };
}
