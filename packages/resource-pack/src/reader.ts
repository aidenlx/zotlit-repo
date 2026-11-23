import type { PackFailure } from "#format.ts";

import { PACK_COMPAT, PACK_INDEX_BYTES, parseIndex } from "#format.ts";
import { sha256Hex } from "#sha256.ts";

export type ReadRange = (offset: number, length: number) => Promise<Uint8Array>;

export interface PackEntryLocation {
  readonly url: string;
  readonly entry: string;
  readonly version: string;
}

export class PackAbsentError extends Error {
  override readonly name = "PackAbsentError";
}

export type PackRead =
  | {
      readonly ok: true;
      readonly bytes: Uint8Array<ArrayBuffer>;
      readonly sha256: string;
      readonly upstreamVersion: string | undefined;
    }
  | { readonly ok: false; readonly failure: PackFailure };

export function bytesRange(pack: Uint8Array): ReadRange {
  return async (offset, length) => pack.subarray(offset, offset + length);
}

const refused = (failure: PackFailure): PackRead => ({ ok: false, failure });

const detailOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

async function decodeEntry(text: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const response = await fetch(
    `data:application/octet-stream;base64,${new TextDecoder().decode(text)}`,
  );
  if (!response.body) throw new Error("The entry decoded to no body");
  const raw = response.body.pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(raw).arrayBuffer());
}

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
    return {
      ok: true,
      bytes: await decodeEntry(text),
      sha256: entry.sha256,
      upstreamVersion: entry.upstreamVersion,
    };
  } catch (error) {
    return refused({ kind: "entry-damaged", name, detail: detailOf(error) });
  }
}
