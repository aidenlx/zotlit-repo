const FORBIDDEN_CHARS = /[\\/:*?"<>|#^[\]]/g;

const WINDOWS_RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

function isBidirectionalFormattingControl(codePoint: number): boolean {
  return (
    codePoint === 0x061c ||
    codePoint === 0x200e ||
    codePoint === 0x200f ||
    (codePoint >= 0x202a && codePoint <= 0x202e) ||
    (codePoint >= 0x2066 && codePoint <= 0x2069)
  );
}

function stripBidirectionalFormattingControls(input: string): string {
  let result = "";
  for (const character of input) {
    if (!isBidirectionalFormattingControl(character.codePointAt(0)!)) {
      result += character;
    }
  }
  return result;
}

export const MAX_SEGMENT_BYTES = 255;

export function normalizeFilename(input: string): string {
  let result = input
    .replaceAll(FORBIDDEN_CHARS, "_")
    .replace(/[. ]+$/, "")
    .replace(/^\.+/, "");
  if (WINDOWS_RESERVED.test(result)) result = `_${result}`;
  return result;
}

function utf8ByteLength(codePoint: number): number {
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
}

export function truncateToByteLimit(name: string, maxBytes: number): string {
  let byteCount = 0;
  let endIndex = 0;
  for (const cp of name) {
    const cpBytes = utf8ByteLength(cp.codePointAt(0)!);
    if (byteCount + cpBytes > maxBytes) break;
    byteCount += cpBytes;
    endIndex += cp.length;
  }
  if (endIndex >= name.length) return name;
  return name.slice(0, endIndex).replace(/[. ]+$/, "");
}

const MD_EXT_BYTES = 3;

export function resolveFlatNoteName(rendered: string): string | null {
  const name = truncateToByteLimit(
    normalizeFilename(rendered),
    MAX_SEGMENT_BYTES - MD_EXT_BYTES,
  );
  return name === "" ? null : name;
}

export function resolveNoteRelPath(rendered: string | null): string | null {
  if (rendered === null) return null;
  const segments = stripBidirectionalFormattingControls(rendered).split("/");
  const filename = resolveFlatNoteName(segments.pop() ?? "");
  if (filename === null) return null;

  const folders = segments
    .map((segment) =>
      truncateToByteLimit(normalizeFilename(segment), MAX_SEGMENT_BYTES),
    )
    .filter((segment) => segment !== "");
  return [...folders, filename].join("/");
}

const NO_BREAK_SPACES = / | /g;

function normalizeNoteFolder(folder: string): string {
  const dir = folder
    .replaceAll(/[\\/]+/g, "/")
    .replaceAll(/^\/|\/$/g, "")
    .replaceAll(NO_BREAK_SPACES, " ")
    .normalize("NFC");
  return dir === "." ? "" : dir;
}

export function joinNotePath(folder: string, rel: string): string {
  const dir = normalizeNoteFolder(folder);
  return dir === "" ? `${rel}.md` : `${dir}/${rel}.md`;
}
