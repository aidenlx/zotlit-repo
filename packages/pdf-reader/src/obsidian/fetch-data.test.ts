import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

import { runInElectron, testElectron } from "@zotlit/scripts/electron-renderer";
import {
  OBSIDIAN_RUNTIME_VERSION,
  missingObsidianRuntime,
} from "@zotlit/scripts/obsidian-runtime";
import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

import type { StandardFontsReport } from "./fetch-data.browser-test.ts";

import { binaryAssets } from "#test/vite.ts";

const obsidianFonts = resolve(
  await getWorkspaceRoot(import.meta.dirname),
  `node_modules/.ob-rev-${OBSIDIAN_RUNTIME_VERSION}/lib/pdfjs/standard_fonts`,
);

it.skipIf(!testElectron)(
  "renders the 14 standard fonts the same from Obsidian 1.15.1's font files as from the fork's",
  async () => {
    if (!existsSync(obsidianFonts)) {
      throw new Error(missingObsidianRuntime(obsidianFonts));
    }
    const report = (await runInElectron({
      entry: resolve(import.meta.dirname, "fetch-data.browser-test.ts"),
      name: "pdfReaderStandardFontsTrial",
      marker: "PDF_READER_STANDARD_FONTS_RESULT",
      plugins: [binaryAssets],
      alias: { "@obsidian-standard-fonts": obsidianFonts },
      timeoutMs: 60_000,
    })) as StandardFontsReport;
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

    expect(report.obsidianFiles).toBe(14);
    expect(report.requested.fork).toEqual(
      expect.arrayContaining([
        "standard-font:FoxitSymbol.pfb",
        "standard-font:FoxitDingbats.pfb",
      ]),
    );
    expect(report.requested.obsidian.toSorted()).toEqual(
      report.requested.fork.toSorted(),
    );
    expect(report.differentFiles).toEqual([]);
    expect(report.items.equal).toBe(true);
    expect(report.items.count).toBeGreaterThanOrEqual(14);
    expect(report.pixels.inked).toBeGreaterThan(20_000);
    expect(report.pixels.differing).toBe(0);
  },
  90_000,
);
