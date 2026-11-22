import type { ContractRoot } from "@zotlit/db";
import type {
  ContractIR,
  ContractObject,
  ContractType,
} from "@zotlit/db/contract/ir";
import contractIRJson from "@zotlit/db/contract/ir.json" with { type: "json" };

const contractIR = contractIRJson as ContractIR;
const UNKNOWN_CONTRACT_TYPE: ContractType = { kind: "unknown" };

export const MARKER_KEYS = ["$ref", "$inert", "$helper"] as const;

export function applyFieldAllowList(
  root: Record<string, unknown>,
  contractRoot: ContractRoot,
  customFields: ReadonlySet<string>,
): Record<string, unknown> {
  const rootType = contractIR.roots[contractRoot]?.type;
  if (!rootType) {
    throw new Error(
      `The Template contract declares no root '${contractRoot}'.`,
    );
  }
  return prune(root, { kind: "ref", name: rootType }, customFields) as Record<
    string,
    unknown
  >;
}

function prune(
  value: unknown,
  type: ContractType,
  customFields: ReadonlySet<string>,
): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => prune(entry, arrayItems(type), customFields));
  }
  if (!isRecord(value)) return value;
  if (MARKER_KEYS.some((key) => key in value)) return value;

  const shapes = objectShapes(type);
  if (shapes.length === 0) return value;

  const declared = new Map<string, ContractType>();
  for (const shape of shapes) {
    for (const member of shape.members) {
      if (!declared.has(member.name)) declared.set(member.name, member.type);
    }
  }
  const fields = shapes.some(
    (shape) => shape.additional?.schema === "item-fields",
  )
    ? allowedItemFields(value, customFields)
    : undefined;

  const pruned: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    const memberType = declared.get(key);
    if (memberType) {
      pruned[key] = prune(entry, memberType, customFields);
    } else if (fields?.has(key)) {
      pruned[key] = entry;
    }
  }
  return pruned;
}

function allowedItemFields(
  record: Record<string, unknown>,
  customFields: ReadonlySet<string>,
): ReadonlySet<string> {
  const itemType = record.itemType;
  const declared =
    typeof itemType === "string" &&
    Object.hasOwn(contractIR.itemTypes, itemType)
      ? contractIR.itemTypes[itemType]
      : undefined;
  return new Set([...(declared ?? []), ...customFields]);
}

function objectShapes(
  type: ContractType,
  seen: ReadonlySet<string> = new Set(),
): ContractObject[] {
  if (type.kind === "ref") {
    if (seen.has(type.name)) return [];
    return objectShapes(
      contractIR.types[type.name] ?? UNKNOWN_CONTRACT_TYPE,
      new Set([...seen, type.name]),
    );
  }
  if (type.kind === "object") return [type];
  if (type.kind === "union") {
    return type.options.flatMap((option) => objectShapes(option, seen));
  }
  return [];
}

function arrayItems(type: ContractType): ContractType {
  const resolved = resolveRef(type);
  if (resolved.kind === "array") return resolved.items;
  if (resolved.kind === "union") {
    for (const option of resolved.options) {
      const items = arrayItems(option);
      if (items.kind !== "unknown") return items;
    }
  }
  return UNKNOWN_CONTRACT_TYPE;
}

function resolveRef(type: ContractType): ContractType {
  let resolved = type;
  const seen = new Set<string>();
  while (resolved.kind === "ref") {
    if (seen.has(resolved.name)) return UNKNOWN_CONTRACT_TYPE;
    seen.add(resolved.name);
    resolved = contractIR.types[resolved.name] ?? UNKNOWN_CONTRACT_TYPE;
  }
  return resolved;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
