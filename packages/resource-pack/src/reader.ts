// The pack reader: the raw bytes of one Pack Entry, through one capability.
// It loads on every host (the plugin's main thread, a Web Worker, a phone), so
// it takes the pack file as a `ReadRange` and uses web APIs only.
import type { PackFailure } from "#format.ts";

import { PACK_COMPAT, PACK_INDEX_BYTES, parseIndex } from "#format.ts";
import { sha256Hex } from "#sha256.ts";

/**
 * The one capability the reader takes: `length` bytes at `offset` of the pack
 * file, or fewer when the file ends first. It rejects with `PackAbsentError`
 * when there is no pack file, and with any other error when the read fails.
 */
export type ReadRange = (offset: number, length: number) => Promise<Uint8Array>;

/**
 * One Pack Entry of an installed pack, for a reader in another realm: the
 * main thread names it, and a Web Worker reads it through `fetchRange(url)`.
 */
export interface PackEntryLocation {
  /** The resource URL of the pack file. */
  readonly url: string;
  /** The name of the Pack Entry. */
  readonly entry: string;
  /** The version of the pack, as its manifest states it. */
  readonly version: string;
  /**
   * The SHA-256 of the entry text, from the index of the last read that gave
   * the verified binary: the identity of the bytes. `null` while that pack is
   * unread, and after a read that gave no binary.
   */
  readonly sha256: string | null;
}

/** A `ReadRange` rejects with this when the host has no pack file. */
export class PackAbsentError extends Error {
  override readonly name = "PackAbsentError";
}

export type PackRead =
  | {
      readonly ok: true;
      readonly bytes: Uint8Array<ArrayBuffer>;
      /** The SHA-256 of the entry text, as the index states it. */
      readonly sha256: string;
    }
  | { readonly ok: false; readonly failure: PackFailure };

/** A `ReadRange` over a pack held in memory. */
export function bytesRange(pack: Uint8Array): ReadRange {
  return async (offset, length) => pack.subarray(offset, offset + length);
}

const refused = (failure: PackFailure): PackRead => ({ ok: false, failure });

const detailOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * The binary an entry text holds. The host's own base64 decoder runs through a
 * `data:` URL: `Uint8Array.fromBase64` is a slow polyfill on WebView 124 and
 * absent in its Worker.
 */
async function decodeEntry(text: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const response = await fetch(
    `data:application/octet-stream;base64,${new TextDecoder().decode(text)}`,
  );
  if (!response.body) throw new Error("The entry decoded to no body");
  const raw = response.body.pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(raw).arrayBuffer());
}

/**
 * Reads the Pack Entry `name`: the index, the compatibility integer, the entry
 * text, its SHA-256, then base64 and gzip. Every call reads the pack file
 * again, so a pack that changes is seen on the next read.
 */
export async function readPackEntry(
  read: ReadRange,
  name: string,
): Promise<PackRead> {
  let head: Uint8Array;
  try {
    head = await read(0, PACK_INDEX_BYTES);
  } catch (error) {
    return refused(
      error instanceof PackAbsentError
        ? { kind: "pack-absent" }
        : { kind: "pack-unreadable", detail: detailOf(error) },
    );
  }
  const index = parseIndex(head);
  if (!index) {
    return refused({
      kind: "pack-unreadable",
      detail: "The file does not start with a pack index",
    });
  }
  if (index.compat !== PACK_COMPAT) {
    return refused({
      kind: index.compat < PACK_COMPAT ? "pack-outdated" : "plugin-outdated",
      pack: index.compat,
      reader: PACK_COMPAT,
    });
  }
  const entry = index.entries.find((candidate) => candidate.name === name);
  if (!entry) return refused({ kind: "entry-missing", name });

  let text: Uint8Array;
  try {
    text = await read(entry.offset, entry.length);
  } catch (error) {
    return refused({ kind: "pack-unreadable", detail: detailOf(error) });
  }
  const actual = await sha256Hex(text);
  if (actual !== entry.sha256) {
    return refused({
      kind: "entry-damaged",
      name,
      detail: `The entry text hashes to ${actual}, and the index states ${entry.sha256}`,
    });
  }
  try {
    return { ok: true, bytes: await decodeEntry(text), sha256: entry.sha256 };
  } catch (error) {
    return refused({ kind: "entry-damaged", name, detail: detailOf(error) });
  }
}
