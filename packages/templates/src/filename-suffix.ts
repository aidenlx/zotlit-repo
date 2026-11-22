import { regex } from "arkregex";

const MARKER_RE = regex(
  "%zt-suffix:(?<length>\\d+):(?<prepend>[^:%]*):(?<append>[^:%]*)%",
  "g",
);

const MAX_SUFFIX_LENGTH = 64;

export interface SuffixSpec {
  length: number;
  prepend: string;
  append: string;
}

export function filenameSuffix(length = 6, prepend = "_", append = ""): string {
  if (!Number.isInteger(length) || length < 1 || length > MAX_SUFFIX_LENGTH) {
    throw new Error(
      `suffix() length must be an integer in 1..${MAX_SUFFIX_LENGTH}, got ${length}`,
    );
  }
  for (const [name, value] of [
    ["prepend", prepend],
    ["append", append],
  ] as const) {
    if (/[:%]/.test(value)) {
      throw new Error(
        `suffix() ${name} must not contain ':' or '%', got ${JSON.stringify(value)}`,
      );
    }
  }
  return `%zt-suffix:${length}:${prepend}:${append}%`;
}

export function hasSuffixMarker(rendered: string): boolean {
  return rendered.search(MARKER_RE) !== -1;
}

export function replaceSuffixMarkers(
  rendered: string,
  fill: (spec: SuffixSpec) => string,
): string {
  MARKER_RE.lastIndex = 0;
  let out = "";
  let last = 0;
  for (
    let match = MARKER_RE.exec(rendered);
    match;
    match = MARKER_RE.exec(rendered)
  ) {
    const { length, prepend, append } = match.groups;
    out +=
      rendered.slice(last, match.index) +
      fill({ length: Number(length), prepend, append });
    last = match.index + match[0].length;
  }
  return out + rendered.slice(last);
}
