// The Citation Template the Citation Suggester inserts with: the notes
// feature's render, with an inert template folded into the answer.
import type { CitationTemplate } from "@zotlit/citations/obsidian/citation-suggest/register.ts";

import { InertTemplateError } from "@/services/template/errors.ts";

import type { NoteCitations } from "./citations-handle.ts";

/** The Citation Template over the notes feature's citation renders. */
export function citationTemplateOf(
  citations: Pick<NoteCitations, "renderCitation">,
): CitationTemplate {
  return {
    renderCitation(items, variant) {
      try {
        return citations.renderCitation(items, variant);
      } catch (cause) {
        // The message names the inert template, ready to show verbatim.
        if (cause instanceof InertTemplateError)
          return { inert: cause.message };
        throw cause;
      }
    },
  };
}
