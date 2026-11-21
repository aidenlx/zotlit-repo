// The Resource Pack's content: each Pack Entry from its installed upstream
// package, checked against the pin in this app's package.json (`packEntries`).
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { PackSource } from "@zotlit/resource-pack/writer.ts";
import { writePack } from "@zotlit/resource-pack/writer.ts";

/** What the build pins a Pack Entry to. */
export interface EntryPin {
  /** The version of the upstream package that holds the binary. */
  readonly version: string;
  /** Lowercase hex SHA-256 of the binary. */
  readonly sha256: string;
}

/** The pins of `packEntries` in package.json, by entry name. */
export interface EntryPins {
  readonly "chinese-segmenter": EntryPin;
}

interface PinnedSource {
  readonly source: PackSource;
  /** The binary's licence text and source link. */
  readonly notice: string;
}

/**
 * The web-target binary inside `jieba-wasm`. ZotLit loads it through the same
 * package's web glue.
 */
const JIEBA_BINARY = "pkg/web/jieba_rs_wasm_bg.wasm";
const JIEBA_SOURCE = "https://github.com/fengkx/jieba-wasm";

async function chineseSegmenter(
  pin: EntryPin,
  packageDir: string,
): Promise<PinnedSource> {
  const name = "chinese-segmenter";
  const { version } = JSON.parse(
    await readFile(join(packageDir, "package.json"), "utf8"),
  ) as { version: string };
  if (version !== pin.version) {
    throw new Error(
      `The installed jieba-wasm is ${version}, and the pin of "${name}" is ${pin.version}`,
    );
  }
  const licence = await readFile(join(packageDir, "LICENSE"), "utf8");
  return {
    source: {
      name,
      bytes: new Uint8Array(await readFile(join(packageDir, JIEBA_BINARY))),
      sha256: pin.sha256,
    },
    notice: `${name}: jieba-wasm ${version}, ${JIEBA_SOURCE}\n\n${licence.trim()}`,
  };
}

export interface ResourcePackOptions {
  readonly pins: EntryPins;
  /** Root of the installed `jieba-wasm` package. */
  readonly jiebaWasm: string;
}

/**
 * The bytes of the pack's `main.js`.
 *
 * @throws when an installed package has another version than its pin, or its
 *   binary another hash.
 */
export async function buildResourcePack(
  options: ResourcePackOptions,
): Promise<Uint8Array<ArrayBuffer>> {
  const sources = [
    await chineseSegmenter(
      options.pins["chinese-segmenter"],
      options.jiebaWasm,
    ),
  ];
  return writePack({
    notice: [
      "The Resource Pack redistributes these binaries under their own licences.",
      ...sources.map(({ notice }) => notice),
    ].join("\n\n"),
    entries: sources.map(({ source }) => source),
  });
}
