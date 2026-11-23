export const PACK_COMPAT = 1;

export const PACK_INDEX_BYTES = 4096;

const INDEX_OPEN = "/*zotlit-resource-pack ";
const INDEX_CLOSE = "*/\n";

export interface PackIndexEntry {
  readonly name: string;
  readonly offset: number;
  readonly length: number;
  readonly sha256: string;
  readonly upstreamVersion?: string;
}

export interface PackIndex {
  readonly compat: number;
  readonly entries: readonly PackIndexEntry[];
}

export type PackFailure =
  | { readonly kind: "pack-absent" }
  | {
      readonly kind: "pack-outdated";
      readonly pack: number;
      readonly reader: number;
    }
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
  const { name, offset, length, sha256, upstreamVersion } = value as Record<
    string,
    unknown
  >;
  return (
    typeof name === "string" &&
    Number.isSafeInteger(offset) &&
    Number.isSafeInteger(length) &&
    typeof sha256 === "string" &&
    (upstreamVersion === undefined || typeof upstreamVersion === "string")
  );
}

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
