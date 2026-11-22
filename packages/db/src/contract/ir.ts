import type { ContractRoot, TemplateSlot } from "#contract/roots.ts";

export interface ContractIR {
  $comment: string;
  contractVersion: number;
  roots: Readonly<Partial<Record<ContractRoot, ContractRootIR>>>;
  itemTypes: Readonly<Record<string, readonly string[]>>;
  types: Readonly<Record<string, ContractNamedType>>;
}

export type RuntimeContractIR = Omit<ContractIR, "itemTypes">;

export interface ContractRootIR {
  type: string;
  templates: readonly TemplateSlot[];
  references: readonly ContractReference[];
}

export interface ContractReference {
  owner: string;
  member: string;
  path: string;
}

export type ContractNamedType = ContractObject | ContractUnion;

export type ContractType =
  | ContractPrimitive
  | ContractLiteral
  | ContractUnknown
  | ContractArray
  | ContractRecord
  | ContractRef
  | ContractStringified
  | ContractHelper
  | ContractNamedType;

export interface ContractPrimitive {
  kind: "primitive";
  type: "string" | "number" | "boolean" | "null";
}

export interface ContractLiteral {
  kind: "literal";
  value: string | number | boolean;
  description?: string;
}

export interface ContractUnknown {
  kind: "unknown";
}

export interface ContractArray {
  kind: "array";
  items: ContractType;
}

export interface ContractRecord {
  kind: "record";
  values: ContractType;
}

export interface ContractRef {
  kind: "ref";
  name: string;
}

export interface ContractStringified {
  kind: "stringified";
  type: string;
}

export interface ContractHelper {
  kind: "helper";
  name: string;
  signature: string;
  filter?: string;
  inert?: true;
  value: ContractType;
}

export interface ContractObject {
  kind: "object";
  description?: string;
  members: readonly ContractMember[];
  additional?: ContractAdditionalMembers;
}

export interface ContractAdditionalMembers {
  description?: string;
  type: ContractType;
  schema: "open" | "item-fields";
}

export interface ContractUnion {
  kind: "union";
  description?: string;
  options: readonly ContractType[];
}

export interface ContractMember {
  name: string;
  description?: string;
  optional: boolean;
  type: ContractType;
  examples?: readonly ContractExample[];
}

export interface ContractExample {
  lang?: string;
  code: string;
}
