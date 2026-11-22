import type { DisplayNode } from "#core/data-tree/index.ts";

import { COMMON_FIELDS } from "./completion-fields.ts";
import type { TemplateRoot } from "./model.ts";

import { outputText } from "#core/data-tree/index.ts";

export interface FieldRow {
  readonly node: DisplayNode;
  readonly label: string;
  readonly value: string;
}

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

export function fieldValueText(node: DisplayNode): string {
  if (node.kind === "list-property") return node.preview;
  if (
    node.kind === "value" &&
    (node.valueType === "array" || node.valueType === "object")
  )
    return node.preview ?? "";
  return outputText(node);
}
