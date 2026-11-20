import { resolve } from "node:path";
import { expect, it } from "vitest";

import { runInElectron, testElectron } from "@zotlit/scripts/electron-renderer";

import type { PersistReport } from "./persist.browser-test.ts";

import { binaryAssets, readerAlias } from "#test/vite.ts";

it.skipIf(!testElectron)(
  "reopens a file at its page with its spread, keeps the sidebar and theme for every view, and resets the zoom to fit width",
  async () => {
    const report = (await runInElectron({
      entry: resolve(import.meta.dirname, "persist.browser-test.ts"),
      name: "pdfReaderPersistTrial",
      marker: "PDF_READER_PERSIST_RESULT",
      plugins: [binaryAssets],
      alias: readerAlias,
      timeoutMs: 90_000,
    })) as PersistReport;
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

    const sidebar = { open: true, panel: "outline", width: 220 };
    expect(report.before).toMatchObject({
      spread: "odd",
      sidebar,
      zoom: 1.5,
      scale: 1.5,
      themed: true,
    });
    expect(report.before.pageIndex).toBeGreaterThanOrEqual(4);
    expect(report.reopened).toEqual({
      pageIndex: report.before.pageIndex,
      spread: "odd",
      sidebar,
      zoom: "page-width",
      themed: true,
      rootThemed: true,
      top: expect.any(Number),
    });
    expect(Math.abs(report.reopened.top - report.before.top)).toBeLessThan(2);
    expect(report.stored).toMatchObject({
      pageIndex: report.before.pageIndex,
      spread: "odd",
    });
    expect(
      Math.abs((report.stored as { top: number }).top - report.before.top),
    ).toBeLessThan(2);
    expect(report.otherFile).toEqual({
      spread: "none",
      sidebar,
      pageIndex: 0,
    });
    expect(report.embed).toMatchObject({
      spread: "none",
      sidebarOpen: false,
      positionsAfter: 0,
    });
  },
  120_000,
);
