import { Script } from "node:vm";

import { PACK_INDEX_BYTES, parseIndex } from "@zotlit/resource-pack/format.ts";
import { applyObsidianInstall } from "@zotlit/resource-pack/obsidian/install.ts";
import type { PackPins } from "@zotlit/resource-pack/pins.ts";
import { bytesRange, readPackEntry } from "@zotlit/resource-pack/reader.ts";
import { sha256Hex } from "@zotlit/resource-pack/sha256.ts";

export interface PackReport {
  readonly lines: readonly string[];
  readonly failures: readonly string[];
}

export async function checkPack(
  mainJs: string,
  pins: PackPins,
): Promise<PackReport> {
  const lines: string[] = [];
  const failures: string[] = [];
  try {
    new Script(mainJs);
  } catch (error) {
    failures.push(
      `main.js is not valid JavaScript: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const installed = new TextEncoder().encode(applyObsidianInstall(mainJs));
  const index = parseIndex(installed.subarray(0, PACK_INDEX_BYTES));
  if (!index) {
    return {
      lines,
      failures: [...failures, "main.js does not start with a pack index"],
    };
  }
  const read = bytesRange(installed);
  for (const { name } of index.entries) {
    if (!Object.hasOwn(pins, name)) {
      failures.push(`Pack Entry "${name}" has no pin`);
    }
  }
  for (const [name, pin] of Object.entries(pins)) {
    const result = await readPackEntry(read, name);
    if (!result.ok) {
      failures.push(
        `Pack Entry "${name}" does not read back: ${result.failure.kind}`,
      );
      continue;
    }
    const actual = await sha256Hex(result.bytes);
    if (actual === pin.sha256) {
      lines.push(
        `${name} ${result.bytes.length.toLocaleString("en-US")} B, read back as its pin`,
      );
    } else {
      failures.push(
        `Pack Entry "${name}" reads back as ${actual}, and its pin is ${pin.sha256}`,
      );
    }
  }
  return { lines, failures };
}
