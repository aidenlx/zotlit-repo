function round(value) {
  return Math.round(value * 1e6) / 1e6;
}

export function fingerprint(char) {
  return [
    char.offset,
    char.c,
    char.u,
    char.rect.map(round).join(","),
    char.inlineRect.map(round).join(","),
    char.rotation,
    round(char.baseline),
    round(char.fontSize),
    char.fontName,
    char.spaceAfter ? "S" : "",
    char.wordBreakAfter ? "W" : "",
    char.lineBreakAfter ? "L" : "",
    char.paragraphBreakAfter ? "P" : "",
    char.ignorable ? "I" : "",
  ].join("|");
}
