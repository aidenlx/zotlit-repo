import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { expect, it } from "vitest";

import { runInElectron, testElectron } from "@zotlit/scripts/electron-renderer";
import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

import type { TextStructureReport } from "./text-structure.browser-test.ts";

const PDFS = [
  "pdf-reader/mock-form.pdf",
  "pdf-reader/mock-direct.pdf",
  "sandve-2013/sandve-2013.pdf",
];

async function folderFiles(
  folder: string,
  kind: string,
): Promise<[string, string][]> {
  const names = await readdir(folder);
  return Promise.all(
    names.map(
      async (name) =>
        [
          `${kind}:${name}`,
          (await readFile(resolve(folder, name))).toString("base64"),
        ] as [string, string],
    ),
  );
}

async function trialData() {
  const assets = resolve(
    await getWorkspaceRoot(import.meta.dirname),
    "packages/scripts/lib/fixture/assets",
  );
  const pdfjs = resolve(
    dirname(
      createRequire(import.meta.url).resolve("@zotlit/pdfjs/package.json"),
    ),
    "dist",
  );
  return {
    pdfs: Object.fromEntries(
      await Promise.all(
        PDFS.map(async (name) => [
          name,
          (await readFile(resolve(assets, name))).toString("base64"),
        ]),
      ),
    ),
    files: Object.fromEntries([
      ...(await folderFiles(resolve(pdfjs, "cmaps"), "cmap")),
      ...(await folderFiles(resolve(pdfjs, "standard_fonts"), "standard-font")),
    ]),
  };
}

it.skipIf(!testElectron)(
  "gives a Form XObject page the Structured Characters of the page drawn directly, with base font names",
  async () => {
    const data = JSON.stringify(await trialData());
    const report = (await runInElectron({
      entry: resolve(import.meta.dirname, "text-structure.browser-test.ts"),
      name: "pdfTextStructureTrial",
      marker: "PDF_TEXT_STRUCTURE_RESULT",
      plugins: [
        {
          name: "text-structure-trial-data",
          config: () => ({ define: { __TEXT_STRUCTURE_TRIAL__: data } }),
        },
      ],
      timeoutMs: 90_000,
    })) as TextStructureReport;
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

    expect(report.form.chars).toBeGreaterThan(0);
    expect(report.form.text).toBe(
      "示例示示示例文字用于复现表单对象示例示例文字用于复现表单对象示例S示例文字用于复",
    );
    expect(report.form).toEqual(report.direct);
    expect(report.sameStructure).toBe(true);
    expect(report.requests.some((request) => request.startsWith("cmap:"))).toBe(
      true,
    );
    expect(report.fontNames["sandve-2013/sandve-2013.pdf"].pages).toBe(4);
    for (const summary of Object.values(report.fontNames)) {
      expect(summary.chars).toBeGreaterThan(0);
      expect(summary.resolved).toBe(summary.chars);
      expect(summary.equal).toBe(summary.chars);
      expect(summary.loadedNames).toBe(0);
      expect(summary.engineResolved).toBe(summary.chars);
      expect(summary.engineNames).toBe(0);
    }
  },
  120_000,
);
