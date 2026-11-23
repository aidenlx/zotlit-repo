export type CitationMode = "normal" | "author-in-text" | "suppress-author";

export type CitationLocatorLabel =
  | "book"
  | "chapter"
  | "column"
  | "figure"
  | "folio"
  | "issue"
  | "line"
  | "note"
  | "opus"
  | "page"
  | "paragraph"
  | "part"
  | "section"
  | "sub-verbo"
  | "verse"
  | "volume";

export interface CitationFragment {
  mode: CitationMode;
  prefix: string | null;
  label: CitationLocatorLabel | null;
  locator: string | null;
  suffix: string | null;
}

export type CitationFragmentParseResult =
  | { ok: true; details: CitationFragment }
  | { ok: false; reason: string };

export function parseCitationFragment(
  fragment: string,
): CitationFragmentParseResult {
  if (fragment === "") {
    return { ok: false, reason: "the Citation Fragment is empty" };
  }

  const values: Partial<Record<CitationFragmentParameter, string>> = {};

  for (const pair of fragment.split("&")) {
    const eq = pair.indexOf("=");
    if (eq === -1) {
      return { ok: false, reason: `"${pair}" is missing its "="` };
    }
    const name = pair.slice(0, eq);
    if (name === "") {
      return { ok: false, reason: `"${pair}" has an empty parameter name` };
    }
    if (!isParameter(name)) {
      return {
        ok: false,
        reason: `"${name}" is not a Citation Fragment parameter`,
      };
    }
    if (values[name] !== undefined) {
      return { ok: false, reason: `"${name}" appears more than once` };
    }

    const decoded = decodeValue(pair.slice(eq + 1));
    if (!decoded.ok) {
      return { ok: false, reason: `"${name}" has ${decoded.reason}` };
    }
    const defect = textDefect(decoded.value);
    if (defect) {
      return { ok: false, reason: `"${name}" has ${defect}` };
    }
    values[name] = decoded.value;
  }

  const { mode = "normal", prefix, label, locator, suffix } = values;
  if (!isMode(mode)) {
    return { ok: false, reason: `"mode" does not support "${mode}"` };
  }
  if (label !== undefined && !isLocatorLabel(label)) {
    return { ok: false, reason: `"label" does not support "${label}"` };
  }
  if (label !== undefined && locator === undefined) {
    return { ok: false, reason: `"label" needs a "locator"` };
  }
  if (mode === "author-in-text" && prefix !== undefined) {
    return {
      ok: false,
      reason:
        '"prefix" does not combine with mode=author-in-text; keep the introduction outside the link',
    };
  }
  return {
    ok: true,
    details: {
      mode,
      prefix: prefix ?? null,
      label: label ?? null,
      locator: locator ?? null,
      suffix: suffix ?? null,
    },
  };
}

type CitationFragmentParameter = keyof CitationFragment;

const PARAMETERS: Readonly<Record<CitationFragmentParameter, true>> = {
  mode: true,
  prefix: true,
  label: true,
  locator: true,
  suffix: true,
};
const MODES: Readonly<Record<CitationMode, true>> = {
  normal: true,
  "author-in-text": true,
  "suppress-author": true,
};

function isParameter(name: string): name is CitationFragmentParameter {
  return Object.hasOwn(PARAMETERS, name);
}

function isMode(value: string): value is CitationMode {
  return Object.hasOwn(MODES, value);
}

function isLocatorLabel(value: string): value is CitationLocatorLabel {
  return Object.hasOwn(LOCATOR_LABEL_SHORT, value);
}

type DecodeResult =
  | { ok: true; value: string }
  | {
      ok: false;
      reason: "malformed percent encoding" | "invalid UTF-8 after decoding";
    };

function decodeValue(raw: string): DecodeResult {
  const bytes = new TextEncoder().encode(raw);
  const decoded: number[] = [];
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index]!;
    if (byte !== PERCENT) {
      decoded.push(byte);
      continue;
    }
    const hi = bytes[index + 1];
    const lo = bytes[index + 2];
    if (
      hi === undefined ||
      lo === undefined ||
      !isHexDigit(hi) ||
      !isHexDigit(lo)
    ) {
      return { ok: false, reason: "malformed percent encoding" };
    }
    decoded.push(hexValue(hi) * 16 + hexValue(lo));
    index += 2;
  }
  try {
    return {
      ok: true,
      value: new TextDecoder("utf-8", {
        fatal: true,
        ignoreBOM: true,
      }).decode(new Uint8Array(decoded)),
    };
  } catch {
    return { ok: false, reason: "invalid UTF-8 after decoding" };
  }
}

const PERCENT = 0x25;

function isHexDigit(byte: number): boolean {
  return (
    (byte >= 0x30 && byte <= 0x39) ||
    (byte >= 0x41 && byte <= 0x46) ||
    (byte >= 0x61 && byte <= 0x66)
  );
}

function hexValue(byte: number): number {
  if (byte >= 0x30 && byte <= 0x39) return byte - 0x30;
  if (byte >= 0x41 && byte <= 0x46) return byte - 0x41 + 10;
  return byte - 0x61 + 10;
}

const EDGE_WHITESPACE = new Set([
  0x0009, 0x000a, 0x000b, 0x000c, 0x000d, 0x0020, 0x0085, 0x00a0, 0x1680,
  0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008,
  0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000,
]);
const LINE_BREAK = new Set([0x000a, 0x000d, 0x0085, 0x2028, 0x2029]);

function textDefect(value: string): string | null {
  if (value === "") return "an empty value";
  const first = value.codePointAt(0)!;
  let last = first;
  let hasLineBreak = false;
  let hasControl = false;
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    last = codePoint;
    hasLineBreak ||= LINE_BREAK.has(codePoint);
    hasControl ||= isControl(codePoint);
  }
  if (EDGE_WHITESPACE.has(first) || EDGE_WHITESPACE.has(last)) {
    return "leading or trailing whitespace";
  }
  if (hasLineBreak) return "a line break";
  if (hasControl) return "a control character";
  return null;
}

function isControl(codePoint: number): boolean {
  return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
}

export interface CitationRunItemSource {
  citationKey: string | null;
  notePath: string;
  fragment: string | null;
}

export function citationRunItem(
  source: CitationRunItemSource,
): CitationRunItem | null {
  const citekey =
    source.citationKey || basenameWithoutExtension(source.notePath);
  if (source.fragment === null) {
    return { citekey, details: NORMAL_CITATION, labelShort: null };
  }
  const parsed = parseCitationFragment(source.fragment);
  if (!parsed.ok) return null;
  return {
    citekey,
    details: parsed.details,
    labelShort:
      parsed.details.locator === null
        ? null
        : LOCATOR_LABEL_SHORT[parsed.details.label ?? "page"],
  };
}

const NORMAL_CITATION: CitationFragment = {
  mode: "normal",
  prefix: null,
  label: null,
  locator: null,
  suffix: null,
};

export interface CitationRunItem {
  citekey: string;
  details: CitationFragment;
  labelShort: string | null;
}

function basenameWithoutExtension(path: string): string {
  const slash = path.lastIndexOf("/");
  const file = slash === -1 ? path : path.slice(slash + 1);
  const dot = file.lastIndexOf(".");
  return dot > 0 ? file.slice(0, dot) : file;
}

const LOCATOR_LABEL_SHORT: Readonly<Record<CitationLocatorLabel, string>> = {
  book: "bk.",
  chapter: "chap.",
  column: "col.",
  figure: "fig.",
  folio: "fol.",
  issue: "no.",
  line: "l.",
  note: "n.",
  opus: "op.",
  page: "p.",
  paragraph: "para.",
  part: "pt.",
  section: "sec.",
  "sub-verbo": "s.v.",
  verse: "v.",
  volume: "vol.",
};
