import type { DisplayNode } from "#core/data-tree/index.ts";

import { COMMON_FIELDS } from "./completion-fields.ts";
// Common field labels and values shared by the Explorer and its hosts.
import type { TemplateRoot } from "./model.ts";

import { outputText } from "#core/data-tree/index.ts";

export interface FieldRow {
  readonly node: DisplayNode;
  readonly label: string;
  readonly value: string;
}

/**
 * The common rows for `root` in their fixed order, over display nodes built
 * from that root. A row the paper has no key for is dropped rather than shown
 * empty.
 */
export function commonRows(
  root: TemplateRoot,
  nodes: readonly DisplayNode[],
): FieldRow[] {
  const byKey = new Map(nodes.map((node) => [node.key, node]));
  return COMMON_FIELDS[root].flatMap((field) => {
    const node = byKey.get(field.key);
    return node
      ? [{ node, label: field.label(), value: fieldValueText(node) }]
      : [];
  });
}

/** This paper's value for one row, as the single line a row shows. */
export function fieldValueText(node: DisplayNode): string {
  if (node.kind === "list-property") return node.preview;
  if (
    node.kind === "value" &&
    (node.valueType === "array" || node.valueType === "object")
  )
    return node.preview ?? "";
  return outputText(node);
}
