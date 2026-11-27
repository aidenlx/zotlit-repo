import { normalizeText } from "./field-value.ts";

const DEFAULT_ANNOTATION_COLOR = "#ffd400";

export function annotationValue(value: unknown): string | null {
  const normalized = typeof value === "string" ? normalizeText(value) : "";
  return normalized === "" ? null : normalized;
}

export function annotationColor(value: unknown): string {
  return annotationValue(value) ?? DEFAULT_ANNOTATION_COLOR;
}
