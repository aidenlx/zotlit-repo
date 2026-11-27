import type { AttachmentCandidateLeaf } from "@zotlit/db/item-query";

import type { CandidateSources } from "./candidate-plan.ts";
import { equality } from "./candidate-plan.ts";
import type { FilterNode } from "./filter-plan.ts";
import { lowerIndexedKeySelection } from "./indexed-key-selection.ts";

export function lowerAttachmentCandidate<Item>(
  node: FilterNode<Item>,
  sources: CandidateSources,
): AttachmentCandidateLeaf | null {
  const selection = lowerIndexedKeySelection(
    node,
    "attachments",
    sources.library,
  );
  if (selection?.target === "self")
    return { kind: "keys", keys: selection.keys };
  const equals = equality(
    node,
    (name) =>
      name === "key" ||
      name === "contentType" ||
      name === "linkMode" ||
      name === "fileType",
  );
  if (equals)
    return {
      kind: equals.name as "key" | "contentType" | "linkMode" | "fileType",
      value: equals.value,
    };
  if (
    node.kind === "method" &&
    node.name === "contains" &&
    node.subject.kind === "field" &&
    node.subject.name === "tags" &&
    node.args[0]?.kind === "literal" &&
    typeof node.args[0].value === "string"
  ) {
    return { kind: "tag", value: node.args[0].value };
  }
  return null;
}
