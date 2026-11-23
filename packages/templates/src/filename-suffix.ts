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
  if (!isSuffixLength(length)) {
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
  return suffixMarkers(rendered).length > 0;
}

export function replaceSuffixMarkers(
  rendered: string,
  fill: (spec: SuffixSpec) => string,
): string {
  let out = "";
  let last = 0;
  for (const { start, end, spec } of suffixMarkers(rendered)) {
    out += rendered.slice(last, start) + fill(spec);
    last = end;
  }
  return out + rendered.slice(last);
}

function isSuffixLength(length: number): boolean {
  return Number.isInteger(length) && length >= 1 && length <= MAX_SUFFIX_LENGTH;
}

function suffixMarkers(
  rendered: string,
): Array<{ start: number; end: number; spec: SuffixSpec }> {
  const markers: Array<{ start: number; end: number; spec: SuffixSpec }> = [];
  MARKER_RE.lastIndex = 0;
  for (
    let match = MARKER_RE.exec(rendered);
    match;
    match = MARKER_RE.exec(rendered)
  ) {
    const { prepend, append } = match.groups;
    const length = Number(match.groups.length);
    if (!isSuffixLength(length)) {
      MARKER_RE.lastIndex = match.index + 1;
      continue;
    }
    markers.push({
      start: match.index,
      end: match.index + match[0].length,
      spec: { length, prepend, append },
    });
  }
  return markers;
}
