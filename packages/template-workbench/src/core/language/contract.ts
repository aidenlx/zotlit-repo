import type { ContractMember, ContractType } from "@zotlit/db/contract/ir";
import type { ContractIR } from "@zotlit/db/contract/ir";
import contractJson from "@zotlit/db/contract/ir.json";
import type { TemplatePathSegment } from "@zotlit/db/template-data";
import { formatAccessorPath } from "@zotlit/db/template-data";
export const contract = contractJson as ContractIR;

export function resolve(type: ContractType): ContractType {
  return type.kind === "ref" ? resolve(contract.types[type.name]!) : type;
}
export function members(type: ContractType): readonly ContractMember[] {
  const value = resolve(type);
  if (value.kind === "object") return value.members;
  if (value.kind === "union") return value.options.flatMap(members);
  if (value.kind === "helper") return members(value.value);
  return [];
}
export function describe(type: ContractType): string {
  switch (type.kind) {
    case "primitive":
      return type.type;
    case "literal":
      return JSON.stringify(type.value);
    case "ref":
      return type.name;
    case "array":
      return `${describe(type.items)}[]`;
    case "helper":
      return type.signature;
    case "union":
      return type.options.map(describe).join(" | ");
    case "stringified":
      return type.type;
    default:
      return type.kind;
  }
}
export function child(
  type: ContractType,
  key: string,
): ContractType | undefined {
  const value = resolve(type);
  if (
    value.kind === "array" &&
    (key === "first" || key === "last" || /^\d+$/.test(key))
  )
    return value.items;
  return members(value).find((member) => member.name === key)?.type;
}
export function sampleJson(
  sample: unknown,
  path: readonly string[],
): string | undefined {
  const ancestors = new Map<object, readonly TemplatePathSegment[]>();
  let value = sample;
  path.forEach((key, depth) => {
    if (value && typeof value === "object")
      ancestors.set(value, path.slice(0, depth));
    value = sampleStep(value, key);
  });
  if (value === undefined) return undefined;
  const plain = (
    node: unknown,
    at: readonly TemplatePathSegment[],
  ): unknown => {
    if (typeof node === "function") return String(node);
    if (!node || typeof node !== "object") return node;
    const seen = ancestors.get(node);
    if (seen) return { $ref: formatAccessorPath(seen, "zt") };
    ancestors.set(node, at);
    const out = Array.isArray(node)
      ? node.map((entry, index) => plain(entry, [...at, index]))
      : Object.fromEntries(
          Object.entries(node).map(([key, entry]) => [
            key,
            plain(entry, [...at, key]),
          ]),
        );
    ancestors.delete(node);
    return out;
  };
  return JSON.stringify(plain(value, path));
}
export function sampleValue(sample: unknown, path: readonly string[]): unknown {
  let value = sample;
  for (const key of path) value = sampleStep(value, key);
  return value;
}
function sampleStep(value: unknown, key: string): unknown {
  if (Array.isArray(value) && (key === "first" || key === "last"))
    return key === "first" ? value[0] : value.at(-1);
  if (value && typeof value === "object")
    return (value as Record<string, unknown>)[key];
  return undefined;
}
