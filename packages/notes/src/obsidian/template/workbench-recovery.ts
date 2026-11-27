import type { RenderDiagnostic } from "#core/template/render-diagnostic.ts";
import { Effect } from "effect";
import type { App, EventRef } from "obsidian";

import type { NoticeMessage } from "@zotlit/obsidian-kit/notice.ts";
import {
  logServices,
  withLogCategory,
} from "@zotlit/plugin-kernel/effect-log.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { MissingTemplateError } from "@zotlit/templates/facade";

import { MissingPartialError } from "#core/template/errors.ts";
import { renderFailureDiagnostic } from "#core/template/render-failure.ts";
import {
  captureRenderReport,
  engineEvidence,
} from "#core/template/render-report.ts";

export interface ArrivingProblem {
  readonly diagnostic: RenderDiagnostic;
}

export interface TemplateWorkbenchRequest {
  readonly document?: string;
  readonly problem?: ArrivingProblem;
}

function requestTemplateWorkbench(
  app: App,
  request: TemplateWorkbenchRequest,
): void {
  Effect.runSyncWith(logServices)(
    Effect.logDebug(
      "Requested the Template Workbench from a refused operation",
    ).pipe(
      Effect.annotateLogs({
        document: request.document ?? null,
        problem: request.problem?.diagnostic.code ?? null,
      }),
      withLogCategory("workbench-recovery"),
    ),
  );
  app.workspace.trigger("zotlit:open-template-workbench", request);
}

export function missingPartialNotice(
  error: unknown,
  options: { app?: App } = {},
): NoticeMessage | undefined {
  if (!(error instanceof MissingTemplateError)) return undefined;
  const message = m.notice_note_missing_partial({
    name: error.templateName,
  });
  const { app } = options;
  if (!app) return message;
  const document =
    error instanceof MissingPartialError ? error.documentPath : undefined;
  const classified = {
    ...renderFailureDiagnostic(error, { source: "", language: "liquid" }),
    evidence: engineEvidence(error),
    part: "render" as const,
  };
  const captured = captureRenderReport({
    diagnostic: classified,
    identity: { sourceRevision: "", snapshotRevision: "" },
    trigger: "explicit",
    sequence: 0,
    capturedAt: Temporal.Now.instant().toString(),
    context: document === undefined ? {} : { document },
  });
  const { sequence: _sequence, ...report } = captured;
  const problem: ArrivingProblem = {
    diagnostic: { ...classified, report },
  };
  return {
    title: message,
    actions: [
      {
        label: m.template_workbench_open_layout(),
        run: () =>
          requestTemplateWorkbench(app, {
            ...(document === undefined ? {} : { document }),
            problem,
          }),
      },
    ],
  };
}

declare module "obsidian" {
  interface Workspace {
    on(
      name: "zotlit:open-template-workbench",
      callback: (request: TemplateWorkbenchRequest) => void,
      ctx?: unknown,
    ): EventRef;
  }
}
