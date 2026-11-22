import type { CitationTemplate } from "@zotlit/citations/obsidian/citation-suggest/register.ts";

import type { NoteCitations } from "./citations-handle.ts";

import { InertTemplateError } from "#core/template/errors.ts";

export function citationTemplateOf(
  citations: Pick<NoteCitations, "renderCitation">,
): CitationTemplate {
  return {
    renderCitation(items, variant) {
      try {
        return citations.renderCitation(items, variant);
      } catch (cause) {
        if (cause instanceof InertTemplateError)
          return { inert: cause.message };
        throw cause;
      }
    },
  };
}
