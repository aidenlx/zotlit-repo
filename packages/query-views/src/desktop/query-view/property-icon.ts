import type { QueryFileDataset } from "#core/query-view/query-file.ts";

import { planPath } from "@zotlit/item-query";

import { DATASETS } from "./datasets.ts";
import type { VaultPropertyType } from "./table-notes.ts";
import type { PropertyEntry } from "./view-properties.ts";

import { LITERATURE_NOTE, vaultName } from "#core/query-view/query-file.ts";

const VAULT_ICONS: Record<VaultPropertyType, string> = {
  text: "text",
  multitext: "list",
  number: "binary",
  checkbox: "check-square",
  date: "calendar",
  datetime: "clock",
  tags: "tags",
  aliases: "forward",
};

export function propertyIcon(
  dataset: QueryFileDataset,
  property: Pick<PropertyEntry, "path" | "kind">,
  vaultType?: (name: string) => VaultPropertyType,
): string {
  if (property.kind === "formula") return "square-function";
  if (property.path === LITERATURE_NOTE) return "file";
  if (property.kind === "vault") {
    const name = vaultName(property.path);
    return VAULT_ICONS[name !== null && vaultType ? vaultType(name) : "text"];
  }
  const { engine, sort } = DATASETS[dataset];
  const kind = sort.find(([path]) => path === property.path)?.[2];
  if (kind === "date") return "calendar";
  if (kind === "number") return "binary";
  const planned = planPath(property.path, engine.resolvePath);
  const shape = "shape" in planned ? planned.shape : undefined;
  if (shape?.kind === "list") return "list";
  if (shape?.kind === "scalar" && shape.type === "number") return "binary";
  if (shape?.kind === "scalar" && shape.type === "boolean")
    return "check-square";
  return "text";
}
