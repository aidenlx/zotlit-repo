import { mapCitationItems } from "./citation-items.ts";
import { formatTexCitation, TexCitationError } from "./tex-citation.ts";

export function formatTemplateTexCitation(
  value: unknown,
  command: unknown = "cite",
): string {
  const items = mapCitationItems(
    value,
    "tex_cite",
    (message, itemIndex) =>
      new TexCitationError("invalid-input", message, {
        itemIndex,
        property: "items",
      }),
  );
  if (typeof command !== "string") {
    throw new TexCitationError(
      "invalid-input",
      "tex_cite requires a command name",
      { property: "command" },
    );
  }
  return formatTexCitation(items, command);
}
