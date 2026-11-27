import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { VendoredSource } from "./vendor-upstream.ts";
import {
  daySuffixes,
  installVendoredTree,
  readPropertiesValue,
} from "./vendor-upstream.ts";

const KEY = "date.daySuffixes";
const work: string[] = [];

async function directory(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "zotlit-vendor-test-"));
  work.push(root);
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}

afterEach(async () => {
  for (const root of work.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("readPropertiesValue", () => {
  it("reads the value of a key with or without spaces around the separator", () => {
    expect(readPropertiesValue(`a=1\n${KEY}=er, , ,\n`, KEY, "fr")).toBe(
      "er, , ,",
    );
    expect(
      readPropertiesValue(`${KEY}     = st, nd, rd, th\r\n`, KEY, "en"),
    ).toBe("st, nd, rd, th");
    expect(readPropertiesValue(`${KEY}: ., ., ., .`, KEY, "de")).toBe(
      "., ., ., .",
    );
  });

  it("fails on a value continued on the next line", () => {
    expect(() =>
      readPropertiesValue(`${KEY}=st, nd,\\\n  rd, th`, KEY, "xx"),
    ).toThrow(/backslash/);
  });

  it("fails on an escape such as \\u", () => {
    expect(() =>
      readPropertiesValue(`${KEY}=\\u65e5, \\u65e5`, KEY, "xx"),
    ).toThrow(/backslash/);
  });

  it("counts a key only at the start of a logical line, not inside a continued value or after a comment", () => {
    expect(
      readPropertiesValue(
        `other=one, \\\n  ${KEY}=not a key\n${KEY}=st, nd, rd, th`,
        KEY,
        "xx",
      ),
    ).toBe("st, nd, rd, th");
    expect(() =>
      readPropertiesValue(`other=one, \\\n  ${KEY}=not a key`, KEY, "xx"),
    ).toThrow(/no /);
    expect(readPropertiesValue(`# note \\\n${KEY}=er`, KEY, "fr")).toBe("er");
    expect(readPropertiesValue(`path=C:\\\\\n${KEY}=er`, KEY, "fr")).toBe("er");
  });

  it("fails on a key that the file holds twice, and on a missing key", () => {
    expect(() => readPropertiesValue(`${KEY}=a\n${KEY}=b`, KEY, "xx")).toThrow(
      /more than one/,
    );
    expect(() => readPropertiesValue("a=1", KEY, "xx")).toThrow(/no /);
  });
});

describe("installVendoredTree", () => {
  const source = (
    build: (tree: string) => Promise<string>,
  ): VendoredSource => ({
    repository: "zotero/zotero",
    dest: "unused",
    paths: ["data.txt"],
    extracts: { "day-suffixes.json": { source: "the day suffixes", build } },
    next: "",
  });

  it("copies the paths, writes each extract and the provenance", async () => {
    const tree = await directory({
      "data.txt": "new",
      "chrome/locale/en-US/zotero/zotero.properties": `${KEY}=st, nd, rd, th`,
    });
    const dest = await directory({ "data.txt": "old" });
    await installVendoredTree({
      source: source(daySuffixes),
      tree,
      dest,
      commit: "b".repeat(40),
    });
    expect(await readFile(join(dest, "data.txt"), "utf8")).toBe("new");
    expect(
      JSON.parse(await readFile(join(dest, "day-suffixes.json"), "utf8")),
    ).toEqual({ "en-US": "st, nd, rd, th" });
    expect(
      JSON.parse(await readFile(join(dest, "provenance.json"), "utf8")),
    ).toMatchObject({
      commit: "b".repeat(40),
      extracts: { "day-suffixes.json": "the day suffixes" },
    });
  });

  it("changes nothing in the destination when an extract fails", async () => {
    const tree = await directory({
      "data.txt": "new",
      "chrome/locale/en-US/zotero/zotero.properties": "date.renamed=st",
    });
    const files = {
      "data.txt": "old",
      "day-suffixes.json": "{}\n",
      "provenance.json": `{"commit":"${"a".repeat(40)}"}\n`,
    };
    const dest = await directory(files);
    await expect(
      installVendoredTree({
        source: source(daySuffixes),
        tree,
        dest,
        commit: "b".repeat(40),
      }),
    ).rejects.toThrow(/no date.daySuffixes entry/);
    for (const [path, content] of Object.entries(files)) {
      expect(await readFile(join(dest, path), "utf8")).toBe(content);
    }
  });
});
