import { resolve } from "node:path";
import { expect, it } from "vitest";

import { runInElectron, testElectron } from "@zotlit/scripts/electron-renderer";

import type { DocumentReport } from "./document.browser-test.ts";

import { binaryAssets, readerAlias } from "#test/vite.ts";

it.skipIf(!testElectron)(
  "gives every text item of a Form XObject page the same chars as the page drawn directly",
  async () => {
    const report = (await runInElectron({
      entry: resolve(import.meta.dirname, "document.browser-test.ts"),
      name: "pdfReaderDocumentTrial",
      marker: "PDF_READER_DOCUMENT_RESULT",
      plugins: [binaryAssets],
      alias: readerAlias,
      timeoutMs: 60_000,
    })) as DocumentReport;
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

    expect(report.form.items).toBeGreaterThan(0);
    expect(report.form.withChars).toBe(report.form.items);
    expect(report.form).toEqual(report.direct);
    expect(report.sameChars).toBe(true);
    expect(report.cached).toBe(true);
    expect(report.retired).toEqual({ current: false, text: false });
    expect(report.cmaps.length).toBeGreaterThan(0);
  },
  90_000,
);
