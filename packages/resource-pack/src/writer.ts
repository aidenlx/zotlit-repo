import type { PackIndexEntry } from "#format.ts";

import { PACK_COMPAT, PACK_INDEX_BYTES, encodeIndex } from "#format.ts";
import { sha256Hex } from "#sha256.ts";

export interface PackSource {
  readonly name: string;
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly sha256: string;
}

export interface PackOptions {
  readonly compat?: number;
  readonly notice?: string;
  readonly entries: readonly PackSource[];
  readonly gzip?: (bytes: Uint8Array<ArrayBuffer>) => Promise<Uint8Array>;
}

const PLUGIN = `"use strict";
module.exports = class ZotLitResources extends require("obsidian").Plugin {};
`;

const ENTRIES_OPEN =
  "/* Pack Entries: one line each, gzip then base64. The index on line 1 states where each is.\n";
const ENTRIES_CLOSE = "*/\n";

const ENTRY_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

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

async function streamGzip(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
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

export async function writePack(
  options: PackOptions,
): Promise<Uint8Array<ArrayBuffer>> {
  const { compat = PACK_COMPAT, notice, entries, gzip = streamGzip } = options;
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
