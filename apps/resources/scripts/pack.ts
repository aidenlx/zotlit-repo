// The Resource Pack's content: each Pack Entry from its installed upstream
// package, checked against the pin in this app's package.json (`packEntries`).
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { constants, gzip } from "node:zlib";

import type { PackEntryPin, PackPins } from "@zotlit/resource-pack/pins.ts";
import type { PackSource } from "@zotlit/resource-pack/writer.ts";
import { writePack } from "@zotlit/resource-pack/writer.ts";

const packageRoot = resolve(import.meta.dirname, "..");

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

/** @throws when package.json pins no entry `name`. */
function pinOf(pins: PackPins, name: string): PackEntryPin {
  const pin = pins[name];
  if (!pin) throw new Error(`package.json has no pin for "${name}"`);
  return pin;
}

async function chineseSegmenter(
  pins: PackPins,
  packageDir: string,
): Promise<PinnedSource> {
  const name = "chinese-segmenter";
  const pin = pinOf(pins, name);
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

/** The binary inside `pandoc-wasm`: the `pandoc.wasm` of the official Pandoc release. */
const PANDOC_BINARY = "src/pandoc.wasm";
/** The file of `pandoc-wasm` that states the Pandoc release its binary is. */
const PANDOC_VERSION = "pandoc-version.txt";
/** The GNU General Public License, version 2: `COPYING.md` of the Pandoc source. */
const PANDOC_COPYING = join(packageRoot, "licences", "pandoc-COPYING.txt");

async function pandocEngine(
  pins: PackPins,
  packageDir: string,
): Promise<PinnedSource> {
  const name = "pandoc-engine";
  const pin = pinOf(pins, name);
  const version = (
    await readFile(join(packageDir, PANDOC_VERSION), "utf8")
  ).trim();
  if (version !== pin.version) {
    throw new Error(
      `The installed pandoc-wasm holds Pandoc ${version}, and the pin of "${name}" is ${pin.version}`,
    );
  }
  const licence = await readFile(join(packageDir, "LICENSE"), "utf8");
  const copying = await readFile(PANDOC_COPYING, "utf8");
  return {
    source: {
      name,
      bytes: new Uint8Array(await readFile(join(packageDir, PANDOC_BINARY))),
      sha256: pin.sha256,
    },
    notice: [
      `${name}: Pandoc ${version}, GPL-2.0-or-later. Source code: https://github.com/jgm/pandoc/tree/${version}`,
      `Packaged for WebAssembly by pandoc-wasm, https://github.com/pandoc/pandoc-wasm`,
      licence.trim(),
      copying.trim(),
    ].join("\n\n"),
  };
}

/**
 * The smallest gzip zlib writes. The pack is built once and downloaded by
 * each researcher, so the build takes the time.
 */
const gzipSmallest = promisify(gzip);

export interface ResourcePackOptions {
  /** `packEntries` of package.json. */
  readonly pins: PackPins;
  /** Root of the installed `jieba-wasm` package. */
  readonly jiebaWasm: string;
  /** Root of the installed `pandoc-wasm` package. */
  readonly pandocWasm: string;
}

/**
 * The bytes of the pack's `main.js`.
 *
 * @throws when an entry has no pin, or when an installed package has another
 *   version than its pin or its binary another hash.
 */
export async function buildResourcePack(
  options: ResourcePackOptions,
): Promise<Uint8Array<ArrayBuffer>> {
  const sources = [
    await chineseSegmenter(options.pins, options.jiebaWasm),
    await pandocEngine(options.pins, options.pandocWasm),
  ];
  return writePack({
    notice: [
      "The Resource Pack redistributes these binaries under their own licences.",
      ...sources.map(({ notice }) => notice),
    ].join("\n\n"),
    entries: sources.map(({ source }) => source),
    gzip: (bytes) =>
      gzipSmallest(bytes, { level: constants.Z_BEST_COMPRESSION }),
  });
}
