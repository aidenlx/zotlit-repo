// The Resource Pack container. The pack's `main.js` is text, in three parts:
//
//   1. the index: one line of `PACK_INDEX_BYTES` bytes, a comment that holds JSON;
//   2. the plugin: a class that extends Obsidian's `Plugin` and does nothing;
//   3. the Pack Entries: one block comment, one line per entry, each the binary
//      as gzip and then base64.
//
// Obsidian downloads and writes `main.js` as a UTF-8 string, removes inline
// source-map lines and appends text at the end. So the pack is text, base64
// keeps every entry on one line that can neither end the comment nor match the
// source-map pattern, and each offset counts bytes from the start of the file.

/**
 * The compatibility integer of the container this code reads and writes. It
 * changes when the container format or the meaning of an entry changes.
 */
export const PACK_COMPAT = 1;

/** The byte length of the index line, its line feed included. */
export const PACK_INDEX_BYTES = 4096;

const INDEX_OPEN = "/*zotlit-resource-pack ";
const INDEX_CLOSE = "*/\n";

/** Where one Pack Entry sits in the pack file. */
export interface PackIndexEntry {
  readonly name: string;
  /** Byte offset of the entry text, from the start of the file. */
  readonly offset: number;
  /** Byte length of the entry text. */
  readonly length: number;
  /** Lowercase hex SHA-256 of the entry text. */
  readonly sha256: string;
}

export interface PackIndex {
  readonly compat: number;
  readonly entries: readonly PackIndexEntry[];
}

/** Why a read of the pack gave no entry. */
export type PackFailure =
  | { readonly kind: "pack-absent" }
  /** The pack is older than this reader: update the Resource Pack. */
  | {
      readonly kind: "pack-outdated";
      readonly pack: number;
      readonly reader: number;
    }
  /** The pack is newer than this reader: update the plugin that reads it. */
  | {
      readonly kind: "plugin-outdated";
      readonly pack: number;
      readonly reader: number;
    }
  | { readonly kind: "entry-missing"; readonly name: string }
  | {
      readonly kind: "entry-damaged";
      readonly name: string;
      readonly detail: string;
    }
  | { readonly kind: "pack-unreadable"; readonly detail: string };

/**
 * The index line.
 *
 * @throws when the index does not fit in `PACK_INDEX_BYTES`.
 */
export function encodeIndex(index: PackIndex): Uint8Array<ArrayBuffer> {
  const json = JSON.stringify(index);
  const padding =
    PACK_INDEX_BYTES - INDEX_OPEN.length - json.length - INDEX_CLOSE.length;
  if (padding < 0) {
    throw new Error(
      `The pack index needs ${-padding} bytes more than its ${PACK_INDEX_BYTES}`,
    );
  }
  return new TextEncoder().encode(
    INDEX_OPEN + json + " ".repeat(padding) + INDEX_CLOSE,
  );
}

function isIndexEntry(value: unknown): value is PackIndexEntry {
  if (typeof value !== "object" || value === null) return false;
  const { name, offset, length, sha256 } = value as Record<string, unknown>;
  return (
    typeof name === "string" &&
    Number.isSafeInteger(offset) &&
    Number.isSafeInteger(length) &&
    typeof sha256 === "string"
  );
}

/**
 * The index that the first `PACK_INDEX_BYTES` bytes of a file hold, or `null`
 * when they are not the index line of a pack. The line's last byte is free, so
 * a pack with converted line endings still names its entries, and each entry
 * then fails its hash.
 */
export function parseIndex(head: Uint8Array): PackIndex | null {
  if (head.length !== PACK_INDEX_BYTES) return null;
  const line = new TextDecoder().decode(head);
  const close = line.lastIndexOf("*/");
  if (!line.startsWith(INDEX_OPEN) || close < 0) return null;
  let index: unknown;
  try {
    index = JSON.parse(line.slice(INDEX_OPEN.length, close));
  } catch {
    return null;
  }
  if (typeof index !== "object" || index === null) return null;
  const { compat, entries } = index as Record<string, unknown>;
  if (!Number.isSafeInteger(compat) || !Array.isArray(entries)) return null;
  if (!entries.every(isIndexEntry)) return null;
  return { compat: compat as number, entries };
}
