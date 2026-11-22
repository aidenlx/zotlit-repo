import type { RenderDiagnostic } from "@zotlit/notes/core/template/render-diagnostic.ts";
import { renderFailureDiagnostic as classifyRenderFailure } from "@zotlit/notes/core/template/render-failure.ts";
import type { RenderCallerSource } from "@zotlit/notes/core/template/render-failure.ts";

import { templateCalls } from "#core/document/regions.ts";

export function renderFailureDiagnosticWithCallSite(
  error: unknown,
  caller: RenderCallerSource,
): Omit<RenderDiagnostic, "part"> {
  return classifyRenderFailure(error, caller, callSites);
}

function callSites(
  { source, language }: RenderCallerSource,
  template: string | undefined,
): { from: number; to: number }[] {
  if (template === undefined) return [];
  return templateCalls(source, { from: 0, to: source.length }, language)
    .filter(({ name }) => name === template)
    .map(({ call }) => call);
}
