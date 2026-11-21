// The pack reader: the raw bytes of one Pack Entry, through one capability.
// It loads on every host (the plugin's main thread, a Web Worker, a phone), so
// it takes the pack file as a `ReadRange` and uses web APIs only.
import type { PackFailure } from "#format.ts";

import { PACK_COMPAT, PACK_INDEX_BYTES, parseIndex } from "#format.ts";

/**
 * The one capability the reader takes: `length` bytes at `offset` of the pack
 * file, or fewer when the file ends first. It rejects with `PackAbsentError`
 * when there is no pack file, and with any other error when the read fails.
 */
export type ReadRange = (offset: number, length: number) => Promise<Uint8Array>;

/** A `ReadRange` rejects with this when the host has no pack file. */
export class PackAbsentError extends Error {
  override readonly name = "PackAbsentError";
}

export type PackRead =
  | { readonly ok: true; readonly bytes: Uint8Array<ArrayBuffer> }
  | { readonly ok: false; readonly failure: PackFailure };

/** A `ReadRange` over a pack held in memory. */
export function bytesRange(pack: Uint8Array): ReadRange {
  return async (offset, length) => pack.subarray(offset, offset + length);
}

const refused = (failure: PackFailure): PackRead => ({ ok: false, failure });

const detailOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

/**
 * The binary an entry text holds. The host's own base64 decoder runs through a
 * `data:` URL: `Uint8Array.fromBase64` is absent on Safari 18.6 and a slow
 * polyfill on WebView 124.
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
  if (text.length !== entry.length || actual !== entry.sha256) {
    return refused({
      kind: "entry-damaged",
      name,
      detail: `The entry text hashes to ${actual}, and the index states ${entry.sha256}`,
    });
  }
  try {
    return { ok: true, bytes: await decodeEntry(text) };
  } catch (error) {
    return refused({ kind: "entry-damaged", name, detail: detailOf(error) });
  }
}
