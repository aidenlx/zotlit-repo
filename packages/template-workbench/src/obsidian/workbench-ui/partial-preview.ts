import type { PartialContext } from "@zotlit/notes/core/template-preview/partial-preview.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

const CONTEXT_LABEL: Record<PartialContext, () => string> = {
  note: m.workbench_partial_context_note,
  annotation: m.workbench_partial_context_annotation,
  citation: m.workbench_partial_context_citation,
};

export function partialContextLabel(context: PartialContext): string {
  return CONTEXT_LABEL[context]();
}
