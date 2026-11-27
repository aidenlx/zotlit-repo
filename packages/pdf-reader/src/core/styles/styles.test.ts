import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it, onTestFailed } from "vitest";

import { runInElectron, testElectron } from "@zotlit/scripts/electron-renderer";

import type { StylesReport } from "./styles.browser-test.ts";

import { binaryAssets, readerAlias } from "#test/vite.ts";

const INHERITED_FROM_BODY = new Set([
  "color",
  "caret-color",
  "column-rule-color",
  "row-rule-color",
  "outline-color",
  "text-decoration-color",
  "text-emphasis-color",
  "-webkit-text-fill-color",
  "-webkit-text-stroke-color",
  "border-block-end-color",
  "border-block-start-color",
  "border-bottom-color",
  "border-inline-end-color",
  "border-inline-start-color",
  "border-left-color",
  "border-right-color",
  "border-top-color",
  "font-family",
  "font-size",
  "line-height",
  "user-select",
  "scrollbar-color",
  "text-rendering",
  "-webkit-tap-highlight-color",
]);

const SIZED_BY_LINE_HEIGHT = new Set([
  "block-size",
  "height",
  "perspective-origin",
  "transform-origin",
]);

const obsidianCss = resolve(
  import.meta.dirname,
  "../../../../../node_modules/.ob-rev-1.15.1/app.css",
);

it.skipIf(!testElectron || !existsSync(obsidianCss))(
  "keeps the text and annotation layers styled the same when Obsidian 1.15.1's app.css is loaded",
  async () => {
    const report = (await runInElectron({
      entry: resolve(import.meta.dirname, "styles.browser-test.ts"),
      name: "pdfReaderStylesTrial",
      marker: "PDF_READER_STYLES_RESULT",
      plugins: [binaryAssets],
      alias: readerAlias,
      timeoutMs: 90_000,
    })) as StylesReport;
    onTestFailed(() => {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    });
    expect(report.available).toBe(true);
    expect(report.controlChanged).toBe(true);
    const { textSpan, thumbnail, ...rest } = report.differences;
    expect(textSpan).toEqual({});
    expect(
      Object.keys(thumbnail).filter(
        (property) =>
          !INHERITED_FROM_BODY.has(property) &&
          !SIZED_BY_LINE_HEIGHT.has(property),
      ),
    ).toEqual([]);
    for (const differences of Object.values(rest)) {
      expect(
        Object.keys(differences).filter(
          (property) => !INHERITED_FROM_BODY.has(property),
        ),
      ).toEqual([]);
    }
    expect(report.spanBox[1]).toBe(report.spanBox[0]);
  },
  120_000,
);
