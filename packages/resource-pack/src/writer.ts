// The pack writer: the text of the Resource Pack's `main.js`. The pack build
// runs it; it uses web APIs only, so the container tests also run it in a
// browser.
import type { PackIndexEntry } from "#format.ts";

import { PACK_COMPAT, PACK_INDEX_BYTES, encodeIndex } from "#format.ts";
import { sha256Hex } from "#sha256.ts";

/** One binary to pack. */
export interface PackSource {
  /** The entry's name in the index: lowercase letters, digits and hyphens. */
  readonly name: string;
  readonly bytes: Uint8Array<ArrayBuffer>;
  /** The pinned lowercase hex SHA-256 of `bytes`. */
  readonly sha256: string;
}

export interface PackOptions {
  /** @default PACK_COMPAT */
  readonly compat?: number;
  /** The licence text and source link of each binary, shown in a comment. */
  readonly notice?: string;
  readonly entries: readonly PackSource[];
}

/**
 * The plugin part. Obsidian loads `main.js` as a CommonJS module and takes the
 * class it exports; this one adds nothing to `Plugin`.
 */
const PLUGIN = `"use strict";
module.exports = class ZotLitResources extends require("obsidian").Plugin {};
`;

const ENTRIES_OPEN =
  "/* Pack Entries: one line each, gzip then base64. The index on line 1 states where each is.\n";
const ENTRIES_CLOSE = "*/\n";

const ENTRY_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/** Bytes per `btoa` call: a multiple of 3, so the parts join with no padding between. */
const BASE64_CHUNK = 3 * 0x4000;

const encoder = new TextEncoder();

function base64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let start = 0; start < bytes.length; start += BASE64_CHUNK) {
    parts.push(
      btoa(String.fromCharCode(...bytes.subarray(start, start + BASE64_CHUNK))),
    );
  }
  return parts.join("");
}

async function gzip(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const packed = new Blob([bytes])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(packed).arrayBuffer());
}

function noticeComment(notice: string): string {
  if (notice.includes("*/")) {
    throw new Error("The pack notice holds `*/`, which ends its comment");
  }
  return `/*\n${notice.trimEnd()}\n*/\n`;
}

/**
 * Writes a pack.
 *
 * @throws when the bytes of an entry differ from its pin, when an entry name
 *   is not lowercase letters, digits and hyphens, or when the index does not
 *   fit its line.
 */
export async function writePack(
  options: PackOptions,
): Promise<Uint8Array<ArrayBuffer>> {
  const { compat = PACK_COMPAT, notice, entries } = options;
  const before = encoder.encode(
    PLUGIN + (notice === undefined ? "" : noticeComment(notice)) + ENTRIES_OPEN,
  );
  const index: PackIndexEntry[] = [];
  const lines: Uint8Array<ArrayBuffer>[] = [];
  let offset = PACK_INDEX_BYTES + before.length;
  for (const { name, bytes, sha256 } of entries) {
    if (!ENTRY_NAME.test(name)) {
      throw new Error(`"${name}" is not an entry name`);
    }
    const actual = await sha256Hex(bytes);
    if (actual !== sha256) {
      throw new Error(
        `The bytes of "${name}" hash to ${actual}, and its pin is ${sha256}`,
      );
    }
    const text = encoder.encode(base64(await gzip(bytes)));
    index.push({
      name,
      offset,
      length: text.length,
      sha256: await sha256Hex(text),
    });
    lines.push(text, encoder.encode("\n"));
    offset += text.length + 1;
  }
  return new Uint8Array(
    await new Blob([
      encodeIndex({ compat, entries: index }),
      before,
      ...lines,
      ENTRIES_CLOSE,
    ]).arrayBuffer(),
  );
}
