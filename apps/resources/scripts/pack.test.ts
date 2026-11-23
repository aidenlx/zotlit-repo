import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { PACK_INDEX_BYTES, parseIndex } from "@zotlit/resource-pack/format.ts";
import { bytesRange, readPackEntry } from "@zotlit/resource-pack/reader.ts";
import { writePack } from "@zotlit/resource-pack/writer.ts";

import { buildResourcePack } from "./pack.ts";

const VERSION = "2.4.0";
const BINARY = new TextEncoder().encode("\0asm pretend jieba");
const LICENSE = "MIT License\n\nCopyright (c) 2018 fengkx\n";

const PANDOC_VERSION = "3.10";
const PANDOC_BINARY = new TextEncoder().encode("\0asm pretend pandoc");
const PANDOC_LICENSE =
  "Pandoc is released under the [GPL], version 2 or later:\n\nCopyright (C) 2006-2024 John MacFarlane\n";

const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

async function installedPackage(version = VERSION) {
  const packageDir = await mkdtemp(join(tmpdir(), "zotlit-jieba-wasm-"));
  await mkdir(join(packageDir, "pkg", "web"), { recursive: true });
  await writeFile(
    join(packageDir, "package.json"),
    JSON.stringify({ name: "jieba-wasm", version }),
  );
  await writeFile(join(packageDir, "LICENSE"), LICENSE);
  await writeFile(
    join(packageDir, "pkg", "web", "jieba_rs_wasm_bg.wasm"),
    BINARY,
  );
  return {
    packageDir,
    [Symbol.asyncDispose]: () =>
      rm(packageDir, { recursive: true, force: true }),
  };
}

async function installedPandoc(version = PANDOC_VERSION) {
  const packageDir = await mkdtemp(join(tmpdir(), "zotlit-pandoc-wasm-"));
  await mkdir(join(packageDir, "src"), { recursive: true });
  await writeFile(join(packageDir, "pandoc-version.txt"), `${version}\n`);
  await writeFile(join(packageDir, "LICENSE"), PANDOC_LICENSE);
  await writeFile(join(packageDir, "src", "pandoc.wasm"), PANDOC_BINARY);
  return {
    packageDir,
    [Symbol.asyncDispose]: () =>
      rm(packageDir, { recursive: true, force: true }),
  };
}

const PINS = {
  "chinese-segmenter": { version: VERSION, sha256: sha256(BINARY) },
  "pandoc-engine": { version: PANDOC_VERSION, sha256: sha256(PANDOC_BINARY) },
};

describe("buildResourcePack", () => {
  it("packs the Chinese Segmenter of the installed package, with its licence and source", async () => {
    await using installed = await installedPackage();
    await using pandoc = await installedPandoc();
    const pack = await buildResourcePack({
      pins: PINS,
      jiebaWasm: installed.packageDir,
      pandocWasm: pandoc.packageDir,
    });

    const read = await readPackEntry(bytesRange(pack), "chinese-segmenter");
    expect(read.ok && Array.from(read.bytes)).toEqual(Array.from(BINARY));
    expect(read.ok && read.upstreamVersion).toBe(
      PINS["chinese-segmenter"].version,
    );
    const text = new TextDecoder().decode(pack);
    expect(text).toContain("Copyright (c) 2018 fengkx");
    expect(text).toContain("https://github.com/fengkx/jieba-wasm");
  });

  it("refuses installed bytes that differ from the pin", async () => {
    await using installed = await installedPackage();
    await using pandoc = await installedPandoc();
    await expect(
      buildResourcePack({
        pins: {
          ...PINS,
          "chinese-segmenter": { version: VERSION, sha256: "0".repeat(64) },
        },
        jiebaWasm: installed.packageDir,
        pandocWasm: pandoc.packageDir,
      }),
    ).rejects.toThrow(
      `The bytes of "chinese-segmenter" hash to ${sha256(BINARY)}, and its pin is ${"0".repeat(64)}`,
    );
  });

  it("refuses an installed package of another version than the pin", async () => {
    await using installed = await installedPackage("2.5.0");
    await using pandoc = await installedPandoc();
    await expect(
      buildResourcePack({
        pins: PINS,
        jiebaWasm: installed.packageDir,
        pandocWasm: pandoc.packageDir,
      }),
    ).rejects.toThrow(
      'The installed jieba-wasm is 2.5.0, and the pin of "chinese-segmenter" is 2.4.0',
    );
  });

  it("packs the Pandoc Engine of the installed package, with the GPL text and the source of its version", async () => {
    await using installed = await installedPackage();
    await using pandoc = await installedPandoc();
    const pack = await buildResourcePack({
      pins: PINS,
      jiebaWasm: installed.packageDir,
      pandocWasm: pandoc.packageDir,
    });

    const read = await readPackEntry(bytesRange(pack), "pandoc-engine");
    expect(read.ok && Array.from(read.bytes)).toEqual(
      Array.from(PANDOC_BINARY),
    );
    const text = new TextDecoder().decode(pack);
    expect(text).toContain("Copyright (C) 2006-2024 John MacFarlane");
    expect(text).toContain("GNU GENERAL PUBLIC LICENSE");
    expect(text).toContain("Version 2, June 1991");
    expect(text).toContain("https://github.com/jgm/pandoc/tree/3.10");
  });

  it("refuses Pandoc bytes that differ from the pin", async () => {
    await using installed = await installedPackage();
    await using pandoc = await installedPandoc();
    await expect(
      buildResourcePack({
        pins: {
          ...PINS,
          "pandoc-engine": { version: PANDOC_VERSION, sha256: "0".repeat(64) },
        },
        jiebaWasm: installed.packageDir,
        pandocWasm: pandoc.packageDir,
      }),
    ).rejects.toThrow(
      `The bytes of "pandoc-engine" hash to ${sha256(PANDOC_BINARY)}, and its pin is ${"0".repeat(64)}`,
    );
  });

  it("refuses an installed Pandoc of another version than the pin", async () => {
    await using installed = await installedPackage();
    await using pandoc = await installedPandoc("3.11");
    await expect(
      buildResourcePack({
        pins: PINS,
        jiebaWasm: installed.packageDir,
        pandocWasm: pandoc.packageDir,
      }),
    ).rejects.toThrow(
      'The installed pandoc-wasm holds Pandoc 3.11, and the pin of "pandoc-engine" is 3.10',
    );
  });

  it("compresses an entry at least as small as the writer's own gzip does", async () => {
    const binary = new Uint8Array(
      await readFile(
        join(
          import.meta.dirname,
          "../node_modules/jieba-wasm/pkg/web/jieba_rs_wasm_bg.wasm",
        ),
      ),
    );
    await using installed = await installedPackage();
    await using pandoc = await installedPandoc();
    await writeFile(join(pandoc.packageDir, "src", "pandoc.wasm"), binary);
    const pins = {
      ...PINS,
      "pandoc-engine": { version: PANDOC_VERSION, sha256: sha256(binary) },
    };
    const lengthOf = (pack: Uint8Array) =>
      parseIndex(pack.subarray(0, PACK_INDEX_BYTES))!.entries.find(
        ({ name }) => name === "pandoc-engine",
      )!.length;

    const built = await buildResourcePack({
      pins,
      jiebaWasm: installed.packageDir,
      pandocWasm: pandoc.packageDir,
    });
    const plain = await writePack({
      entries: [
        { name: "pandoc-engine", bytes: binary, sha256: sha256(binary) },
      ],
    });

    expect(lengthOf(built)).toBeLessThan(lengthOf(plain));
    const read = await readPackEntry(bytesRange(built), "pandoc-engine");
    expect(read.ok && read.bytes.length).toBe(binary.length);
  });
});
