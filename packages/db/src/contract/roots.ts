export const CONTRACT_VERSION = 3;

export const CONTRACT_ROOTS = [
  "note",
  "annotation",
  "filename",
  "citation",
] as const;

export type ContractRoot = (typeof CONTRACT_ROOTS)[number];

export const TEMPLATE_SLOT_ROOTS = {
  note: "note",
  content: "note",
  annotation: "annotation",
  filename: "filename",
} as const satisfies Record<string, ContractRoot>;

export type TemplateSlot = keyof typeof TEMPLATE_SLOT_ROOTS;

export function templateSlotsForRoot(root: ContractRoot): TemplateSlot[] {
  return Object.entries(TEMPLATE_SLOT_ROOTS)
    .filter(([, slotRoot]) => slotRoot === root)
    .map(([slot]) => slot as TemplateSlot);
}
