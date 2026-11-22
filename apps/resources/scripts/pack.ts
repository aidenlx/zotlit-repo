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
  readonly notice: string;
}

const JIEBA_BINARY = "pkg/web/jieba_rs_wasm_bg.wasm";
const JIEBA_SOURCE = "https://github.com/fengkx/jieba-wasm";

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

const PANDOC_BINARY = "src/pandoc.wasm";
const PANDOC_VERSION = "pandoc-version.txt";
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

const gzipSmallest = promisify(gzip);

export interface ResourcePackOptions {
  readonly pins: PackPins;
  readonly jiebaWasm: string;
  readonly pandocWasm: string;
}

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
