// The name a host shows for a Shared Partial preview's own choice: the caller
// the partial is rendered as called from.

import type { PartialContext } from "@zotlit/notes/core/template-preview/partial-preview.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

const CONTEXT_LABEL: Record<PartialContext, () => string> = {
  note: m.workbench_partial_context_note,
  annotation: m.workbench_partial_context_annotation,
  citation: m.workbench_partial_context_citation,
};

/** The chosen caller as the short phrase a caption names it with. */
export function partialContextLabel(context: PartialContext): string {
  return CONTEXT_LABEL[context]();
}
