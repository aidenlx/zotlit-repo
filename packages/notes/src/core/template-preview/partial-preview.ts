export type PartialContext = "note" | "annotation" | "citation";

export const PARTIAL_CONTEXTS = [
  "note",
  "annotation",
  "citation",
] as const satisfies readonly PartialContext[];

export const DEFAULT_PARTIAL_CONTEXT: PartialContext = "note";

export function isPartialContext(value: unknown): value is PartialContext {
  return (PARTIAL_CONTEXTS as readonly unknown[]).includes(value);
}

export interface PartialChoice {
  readonly context: PartialContext;
  readonly profile: string | null;
}

export interface PartialPreviewSelection extends PartialChoice {
  readonly name: string;
}
