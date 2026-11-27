const MULTILINE_FIELDS = new Set(["abstractNote", "extra", "address"]);

export function normalizeText(value: string): string {
  return value.trim().normalize();
}

export function fieldText(value: string | number): string {
  return typeof value === "number" ? String(value) : normalizeText(value);
}

export function singleLineFieldValue(field: string, value: string): string {
  return MULTILINE_FIELDS.has(field)
    ? value
    : value.replaceAll(/[\r\n]+/g, " ");
}
