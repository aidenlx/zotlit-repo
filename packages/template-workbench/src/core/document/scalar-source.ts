import { parseDocument } from "yaml";

export type ScalarStyle = "plain" | "single" | "double";

export function yamlValue(source: string, prefix: string): unknown {
  const lead = prefix.replace(/^(?:\s*-(?=\s))*/, (markers) =>
    " ".repeat(markers.length),
  );
  let value: unknown;
  try {
    const yaml = parseDocument(lead + source, { uniqueKeys: true });
    if (yaml.errors.length > 0) return undefined;
    value = yaml.toJS();
  } catch {
    return undefined;
  }
  if (lead.trim() === "") return value;
  const values =
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? Object.values(value)
      : [];
  return values.length === 1 ? values[0] : undefined;
}

export function scalarDisplay(source: string, prefix: string): string {
  if (source === "") return "";
  const value = yamlValue(source, prefix);
  return typeof value === "string" ? value : source;
}

export function scalarStyle(source: string): ScalarStyle {
  if (source.startsWith("'")) return "single";
  if (source.startsWith('"')) return "double";
  return "plain";
}

function spell(text: string, style: ScalarStyle) {
  const pieces = Array.from(text, (char) => {
    if (style === "single") return char === "'" ? "''" : char;
    if (style === "double") return JSON.stringify(char).slice(1, -1);
    return char;
  });
  const quote = style === "single" ? "'" : style === "double" ? '"' : "";
  return { quote, pieces, source: quote + pieces.join("") + quote };
}

export function scalarSource(text: string, prefer: ScalarStyle): string {
  for (const style of new Set([prefer, "plain", "single"] as const)) {
    const { source } = spell(text, style);
    if (source !== "" && yamlValue(source, "k: ") === text) return source;
  }
  return spell(text, "double").source;
}

function sourceOffsets(display: string, source: string): number[] | null {
  const {
    quote,
    pieces,
    source: spelled,
  } = spell(display, scalarStyle(source));
  if (spelled !== source) return null;
  const offsets = [quote.length];
  let at = quote.length;
  for (const [index, char] of Array.from(display).entries()) {
    const piece = pieces[index]!;
    if (char.length === 2) offsets.push(at);
    at += piece.length;
    offsets.push(at);
  }
  return offsets;
}

export function scalarToSource(
  display: string,
  source: string,
  position: number,
): number {
  const offsets = sourceOffsets(display, source);
  if (!offsets) return Math.min(position, source.length);
  return offsets[Math.min(Math.max(position, 0), display.length)]!;
}

export function scalarToDisplay(
  source: string,
  display: string,
  position: number,
): number {
  const offsets = sourceOffsets(display, source);
  if (!offsets) return Math.min(position, display.length);
  let index = 0;
  while (index < display.length && offsets[index + 1]! <= position) index++;
  return index;
}
