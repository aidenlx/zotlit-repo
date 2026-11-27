import { ISBN_RANGES } from "./isbn-ranges.ts";

const DASHES_RE = /[\x2D\xAD‐-―⁃−]+/g;

export function cleanISBN(input: string, dontValidate = false): string | false {
  const text = input.toUpperCase().replaceAll(DASHES_RE, "");
  const isbnRE = /\b(?:97[89]\s*(?:\d\s*){9}\d|(?:\d\s*){9}[\dX])\b/g;
  let match: RegExpExecArray | null;
  while ((match = isbnRE.exec(text))) {
    const isbn = match[0].replaceAll(/\s+/g, "");
    if (dontValidate) return isbn;
    const digit = (index: number) => Number(isbn[index]);
    let sum = 0;
    if (isbn.length === 10) {
      for (let i = 0; i < 9; i++) sum += digit(i) * (10 - i);
      sum += isbn[9] === "X" ? 10 : digit(9);
      if (sum % 11 === 0) return isbn;
    } else {
      for (let i = 0; i < 12; i += 2) sum += digit(i);
      for (let i = 1; i < 12; i += 2) sum += digit(i) * 3;
      sum += digit(12);
      if (sum % 10 === 0) return isbn;
    }
    isbnRE.lastIndex = match.index + 1;
  }
  return false;
}

export function hyphenateISBN(input: string, dontValidate = false): string {
  const isbn = cleanISBN(input, dontValidate);
  if (!isbn) return "";

  const parts: string[] = [];
  let prefix: string;
  let i = 0;
  if (isbn.length === 10) {
    prefix = "978";
  } else {
    prefix = isbn.slice(0, 3);
    if (!Object.hasOwn(ISBN_RANGES, prefix)) return "";
    parts.push(prefix);
    i = 3;
  }
  const groups = ISBN_RANGES[prefix]!;

  let group = "";
  let found = false;
  while (i < isbn.length - 3) {
    group += isbn.charAt(i);
    if (Object.hasOwn(groups, group)) {
      parts.push(group);
      found = true;
      break;
    }
    i++;
  }
  if (!found) return "";

  const ranges = groups[group]!;
  let registrant = "";
  found = false;
  i++;
  while (!found && i < isbn.length - 2) {
    registrant += isbn.charAt(i);
    for (
      let j = 0;
      j < ranges.length && registrant.length >= ranges[j]!.length;
      j += 2
    ) {
      if (
        registrant.length === ranges[j]!.length &&
        registrant >= ranges[j]! &&
        registrant <= ranges[j + 1]!
      ) {
        parts.push(registrant);
        found = true;
        break;
      }
    }
    i++;
  }
  if (!found) return "";

  parts.push(isbn.slice(i, isbn.length - 1), isbn.charAt(isbn.length - 1));
  return parts.join("-");
}

export function hyphenateIsbnField(value: string): string {
  const hyphenated: string[] = [];
  for (const isbn of value.trim().split(/\s*[,;]\s*|\s+/)) {
    const result = hyphenateISBN(isbn);
    if (!result) return value;
    hyphenated.push(result);
  }
  return hyphenated.join(" ");
}
