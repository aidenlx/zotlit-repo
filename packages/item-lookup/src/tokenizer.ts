import { regex } from "arkregex";

export interface TokenizerOptions {
  intl: Intl.Segmenter;
}

const DIACRITIC = regex("\\p{Diacritic}", "gu");

export function tokenize(text: string, opts: TokenizerOptions): string[] {
  const tokens: string[] = [];
  for (const part of opts.intl.segment(text)) {
    if (!part.isWordLike) continue;
    tokens.push(...splitHyphenated(part.segment));
  }
  return tokens;
}

export function normalize(term: string): string {
  return term
    .toLowerCase()
    .replaceAll("ł", "l")
    .normalize("NFD")
    .replace(DIACRITIC, "");
}

export function normalizeWithIndexMap(text: string): {
  normalized: string;
  indexMap: number[];
} {
  const parts: string[] = [];
  const indexMap: number[] = [];
  let sourceIndex = 0;
  for (const char of text) {
    const piece = normalize(char);
    for (let j = 0; j < piece.length; j++) indexMap.push(sourceIndex);
    parts.push(piece);
    sourceIndex += char.length;
  }
  indexMap.push(text.length);
  return { normalized: parts.join(""), indexMap };
}

function splitHyphenated(token: string): string[] {
  return token.split("-").filter((part) => part.length > 0);
}
