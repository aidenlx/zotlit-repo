import type { ContractExample } from "@zotlit/db/contract/ir";

export type InlineNode =
  | { kind: "text"; value: string }
  | { kind: "code"; value: string }
  | { kind: "link"; href: string; text: string; code: boolean };

export type Doc = readonly (readonly InlineNode[])[];

export interface PageModel {
  sections: readonly PageSection[];
  warnings: readonly string[];
}

export interface PageSection {
  id: string;
  title: string;
  level: 2 | 3;
  lead?: string;
  include?: string;
  description: Doc;
  tables: readonly TableModel[];
  values: readonly SectionValue[];
  itemTypes: readonly ItemTypeRow[];
}

export interface SectionValue {
  value: string;
  description: Doc;
}

export interface TableModel {
  id: string;
  caption?: string;
  description: Doc;
  prefix?: string;
  rows: readonly RowModel[];
}

export interface RowModel {
  name: string;
  optional: boolean;
  shortType: string;
  fullType: string;
  typeHref?: string;
  description: Doc;
  examples: readonly ContractExample[];
  helper?: HelperPresentation;
}

export interface HelperPresentation {
  signature: string;
  liquid: string;
  eta: string;
  filter?: string;
}

export interface ItemTypeRow {
  itemType: string;
  fields: readonly string[];
}

export function sectionOf(
  model: Pick<PageModel, "sections">,
  id: string,
): PageSection {
  const section = model.sections.find((entry) => entry.id === id);
  if (!section) throw new Error(`No contract section ${id}`);
  return section;
}
