// The repair location of one render failure: the call in the source the render
// read that reached the failing template, found by the Workbench's own scan of
// that source.

import type { RenderDiagnostic } from "@zotlit/notes/core/template/render-diagnostic.ts";
import { renderFailureDiagnostic as classifyRenderFailure } from "@zotlit/notes/core/template/render-failure.ts";
import type { RenderCallerSource } from "@zotlit/notes/core/template/render-failure.ts";

import { templateCalls } from "#core/document/regions.ts";

/**
 * The diagnostic one thrown render failure reads as, attributed against the
 * source that render read, with the call that reached the failing template.
 *
 * @see renderFailureDiagnostic in `@zotlit/notes/core/template/render-failure.ts`
 */
export function renderFailureDiagnostic(
  error: unknown,
  caller: RenderCallerSource,
): Omit<RenderDiagnostic, "part"> {
  return classifyRenderFailure(error, caller, callSites);
}

/**
 * Every call in `caller` naming `template`, in source order. Empty for a name
 * the source never spells, so an unnamed location stays unnamed.
 */
function callSites(
  { source, language }: RenderCallerSource,
  template: string | undefined,
): { from: number; to: number }[] {
  if (template === undefined) return [];
  return templateCalls(source, { from: 0, to: source.length }, language)
    .filter(({ name }) => name === template)
    .map(({ call }) => call);
}
