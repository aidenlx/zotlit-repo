import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { bytesRange, readPackEntry } from "@zotlit/resource-pack/reader.ts";

import { buildResourcePack } from "./pack.ts";

const VERSION = "2.4.0";
const BINARY = new TextEncoder().encode("\0asm pretend jieba");
const LICENSE = "MIT License\n\nCopyright (c) 2018 fengkx\n";

const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

/** Writes the layout the pack build reads an installed `jieba-wasm` as. */
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

describe("buildResourcePack", () => {
  it("packs the Chinese Segmenter of the installed package, with its licence and source", async () => {
    await using installed = await installedPackage();
    const pack = await buildResourcePack({
      pins: {
        "chinese-segmenter": { version: VERSION, sha256: sha256(BINARY) },
      },
      jiebaWasm: installed.packageDir,
    });

    const read = await readPackEntry(bytesRange(pack), "chinese-segmenter");
    expect(read.ok && Array.from(read.bytes)).toEqual(Array.from(BINARY));
    const text = new TextDecoder().decode(pack);
    expect(text).toContain("Copyright (c) 2018 fengkx");
    expect(text).toContain("https://github.com/fengkx/jieba-wasm");
  });

  it("refuses installed bytes that differ from the pin", async () => {
    await using installed = await installedPackage();
    await expect(
      buildResourcePack({
        pins: {
          "chinese-segmenter": { version: VERSION, sha256: "0".repeat(64) },
        },
        jiebaWasm: installed.packageDir,
      }),
    ).rejects.toThrow(
      `The bytes of "chinese-segmenter" hash to ${sha256(BINARY)}, and its pin is ${"0".repeat(64)}`,
    );
  });

  it("refuses an installed package of another version than the pin", async () => {
    await using installed = await installedPackage("2.5.0");
    await expect(
      buildResourcePack({
        pins: {
          "chinese-segmenter": { version: VERSION, sha256: sha256(BINARY) },
        },
        jiebaWasm: installed.packageDir,
      }),
    ).rejects.toThrow(
      'The installed jieba-wasm is 2.5.0, and the pin of "chinese-segmenter" is 2.4.0',
    );
  });
});
