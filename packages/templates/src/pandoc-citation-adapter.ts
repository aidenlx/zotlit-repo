// Runtime mapping from template Citation Items to the Pandoc Citation Source Module.

import { mapCitationItems } from "./citation-items.ts";
import {
  formatPandocCitation,
  PandocCitationError,
} from "./pandoc-citation.ts";
import type { PandocCitationForm } from "./pandoc-citation.ts";

export function formatTemplatePandocCitation(
  value: unknown,
  form: unknown = "normal",
): string {
  const items = mapCitationItems(
    value,
    "pandoc_cite",
    (message, itemIndex) =>
      new PandocCitationError("invalid-input", message, {
        itemIndex,
        property: "items",
      }),
  );
  return formatPandocCitation(items, form as PandocCitationForm);
}
