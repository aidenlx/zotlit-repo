import type { PDFDocumentProxy, TextContent } from "#/pdfjs.ts";
import { resolve } from "node:path";
import { expect, it, vi, onTestFailed } from "vitest";

import { runInElectron, testElectron } from "@zotlit/scripts/electron-renderer";

import type { DocumentReport } from "./document.browser-test.ts";
import { manageDocument } from "./document.ts";

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
    onTestFailed(() => {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    });

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

it("reads a page's text again after a failed read and keeps the text that succeeded", async () => {
  const failure = new Error("Text extraction failed");
  const text = { items: [], styles: {}, lang: null } as TextContent;
  const getTextContent = vi
    .fn<() => Promise<TextContent>>()
    .mockRejectedValueOnce(failure)
    .mockResolvedValue(text);
  const proxy = {
    fingerprints: ["fingerprint"],
    getPage: () => Promise.resolve({ getTextContent }),
  } as unknown as PDFDocumentProxy;
  const { document } = manageDocument(proxy, "key");

  await expect(document.textContent(0)).rejects.toBe(failure);
  const [first, second] = await Promise.all([
    document.textContent(0),
    document.textContent(0),
  ]);
  expect(first).toBe(text);
  expect(second).toBe(text);
  expect(await document.textContent(0)).toBe(text);
  expect(getTextContent).toHaveBeenCalledTimes(2);
});
