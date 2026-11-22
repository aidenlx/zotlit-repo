const DISALLOWED =
  /[\u2000-\u206F\u2E00-\u2E7F'!"#$%&()*+,.:;<=>?@^`{|}~[\]\\\s]+/g;

const REPEATED_SLASH = /\/{2,}/g;

const EDGE_SEPARATORS = /^[_/]+|[_/]+$/g;

const ALL_DIGITS = /^[0-9]+$/;

export function normalizeObsidianTag(name: string): string {
  const body = name
    .replaceAll(DISALLOWED, "_")
    .replaceAll(REPEATED_SLASH, "/")
    .replaceAll(EDGE_SEPARATORS, "");
  return ALL_DIGITS.test(body) ? `_${body}` : body;
}
