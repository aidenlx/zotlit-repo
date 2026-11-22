export const cjkGlyph = /[\p{Script=Han}　-〿＀-￯]/u;

export function textWidth(text: string): number {
  let width = 0;
  for (const glyph of text) width += cjkGlyph.test(glyph) ? 2 : 1;
  return width;
}
