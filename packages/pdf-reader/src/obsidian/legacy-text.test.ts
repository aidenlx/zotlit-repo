import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

import { runInElectron, testElectron } from "@zotlit/scripts/electron-renderer";
import {
  OBSIDIAN_RUNTIME_VERSION,
  missingObsidianRuntime,
} from "@zotlit/scripts/obsidian-runtime";
import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

import type { LegacySelectionReport } from "./legacy-text.browser-test.ts";

import { binaryAssets, readerAlias } from "#test/vite.ts";

const obsidianPdfJs = resolve(
  await getWorkspaceRoot(import.meta.dirname),
  `node_modules/.ob-rev-${OBSIDIAN_RUNTIME_VERSION}/lib/pdfjs`,
);

it.skipIf(!testElectron)(
  "reads and writes #selection= links in the indexes of Obsidian 1.15.1's PDF.js",
  async () => {
    if (!existsSync(obsidianPdfJs)) {
      throw new Error(missingObsidianRuntime(obsidianPdfJs));
    }
    const report = (await runInElectron({
      entry: resolve(import.meta.dirname, "legacy-text.browser-test.ts"),
      name: "pdfReaderLegacySelectionTrial",
      marker: "PDF_READER_LEGACY_SELECTION_RESULT",
      plugins: [binaryAssets],
      alias: { ...readerAlias, "@obsidian-pdfjs": obsidianPdfJs },
      timeoutMs: 180_000,
    })) as LegacySelectionReport;
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

    expect(report.version).toBe("5.3.34");
    expect(report.read["mock-form p1"]).toMatchObject({
      obsidianItems: 243,
      forkItems: 154,
      selections: 25,
      matched: 25,
      identityWrong: 25,
    });
    expect(report.read["sakimas-song p5"]).toMatchObject({
      selections: 25,
      matched: 25,
    });
    expect(report.read["sakimas-song p5"]!.identityWrong).toBeGreaterThan(0);
    expect(report.write).toEqual({
      selections: 15,
      sameText: 15,
      differentIndexes: 15,
      quotesWithLink: 15,
      relanded: 15,
    });
    expect(report.fallbacks.outOfRange).toEqual({ marks: "", opened: 1 });
    const pageOnly = {
      marks: "",
      items: ["copy", "copy-as-quote"],
      copied: [
        expect.stringMatching(
          /\n\n\[\[pdf-reader\/mock-form\.pdf#page=1\|mock-form, page 1\]\]$/,
        ),
      ],
      reports: [],
    };
    expect(report.fallbacks.otherText).toEqual(pageOnly);
    expect(report.fallbacks.unreadable).toEqual({
      ...pageOnly,
      reports: ["legacy-selection", "legacy-selection"],
    });
    expect(report.fallbacks.noSource).toEqual(pageOnly);
    expect(report.lifecycle).toEqual({
      passwords: ["zotlit", "zotlit"],
      afterReload: { opened: 2, destroyed: 1 },
      afterDispose: { opened: 2, destroyed: 2 },
      reports: [],
    });
  },
  240_000,
);
