export type PreparedText = { readonly text: string; readonly advance: number };

export function prepare(text: string, font: string): PreparedText {
  const size = font.split(" ").find((part) => part.endsWith("px"));
  return { text, advance: size ? Number.parseFloat(size) / 2 : 0 };
}

export function layout(
  { text, advance }: PreparedText,
  maxWidth: number,
  lineHeight: number,
): { height: number; lineCount: number } {
  const perLine = Math.max(1, Math.floor(maxWidth / advance));
  const lineCount = Math.ceil(text.length / perLine);
  return { height: lineCount * lineHeight, lineCount };
}

export function clearCache(): void {}
