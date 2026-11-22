import { errorValueText } from "./filter-values.ts";

export type ProjectionJson =
  | null
  | string
  | number
  | boolean
  | readonly ProjectionJson[]
  | { readonly [key: string]: ProjectionJson };

export interface ErrorCell {
  readonly kind: "error";
  readonly code: string;
  readonly message: string;
}

export function errorCell(value: ProjectionJson | undefined): ErrorCell | null {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return null;
  const record = value as Readonly<Record<string, ProjectionJson>>;
  return record.kind === "error" &&
    typeof record.code === "string" &&
    typeof record.message === "string"
    ? { kind: "error", code: record.code, message: record.message }
    : null;
}

export function valueText(value: ProjectionJson | undefined): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (Array.isArray(value))
    return value
      .map((entry: ProjectionJson) => valueText(entry))
      .filter((text) => text !== "")
      .join(", ");
  const error = errorCell(value);
  if (error) return errorValueText(error.message);
  const record = value as Readonly<Record<string, ProjectionJson>>;
  if (typeof record.raw === "string") {
    if (typeof record.text === "string" && record.text !== "")
      return record.text;
    const space = record.raw.indexOf(" ");
    return space === -1 ? record.raw : record.raw.slice(space + 1);
  }
  for (const key of ["name", "fullName", "title"])
    if (typeof record[key] === "string" && record[key] !== "")
      return record[key];
  const names = [record.firstName, record.lastName].filter(
    (part): part is string => typeof part === "string" && part !== "",
  );
  return names.length > 0 ? names.join(" ") : JSON.stringify(value);
}
