import { resolve } from "node:path";
import { expect, it } from "vitest";

import { runInElectron, testElectron } from "@zotlit/scripts/electron-renderer";

import type { FindReport } from "./find.browser-test.ts";

import { binaryAssets, readerAlias } from "#test/vite.ts";

it.skipIf(!testElectron)(
  "finds with each option, wraps next and previous, caps the count at 1000, and keeps the options",
  async () => {
    const report = (await runInElectron({
      entry: resolve(import.meta.dirname, "find.browser-test.ts"),
      name: "pdfReaderFindTrial",
      marker: "PDF_READER_FIND_RESULT",
      plugins: [binaryAssets],
      alias: readerAlias,
      timeoutMs: 120_000,
    })) as FindReport;
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

    expect(report.opened).toEqual({ visible: true, focused: true });
    expect(report.phases).toEqual(
      expect.arrayContaining(["idle", "pending", "found", "not-found"]),
    );
    expect(report.fox).toEqual({ current: 1, total: 4, capped: false });
    expect(report.count).toBe("1 of 4 matches");
    expect(report.highlights).toBeGreaterThanOrEqual(4);
    expect(report.cycle).toEqual([2, 3, 4, 1]);
    expect(report.back).toBe(4);
    expect(report.composing).toEqual({ open: true, next: 1 });
    expect(report.whole?.total).toBe(3);
    expect(report.caseAndWhole?.total).toBe(2);
    expect(report.loose?.total).toBe(2);
    expect(report.strict?.total).toBe(1);
    expect(report.missing).toEqual({ phase: "not-found", count: "No matches" });
    expect(report.saved).toEqual({
      caseSensitive: true,
      highlightAll: false,
      matchDiacritics: true,
      entireWord: false,
    });
    expect(report.restored).toEqual({
      caseSensitive: true,
      highlightAll: false,
      matchDiacritics: true,
      entireWord: false,
    });
    expect(report.closed).toEqual({
      escape: true,
      open: false,
      hidden: true,
      highlights: 0,
      again: false,
    });
    expect(report.capped).toMatchObject({ total: 1000, capped: true });
    expect(report.cappedCount).toMatch(/^\d+ of more than 1000 matches$/);
    const stored = {
      caseSensitive: false,
      highlightAll: false,
      matchDiacritics: false,
      entireWord: false,
    };
    expect(report.hash).toEqual({
      open: true,
      query: "sampling",
      highlightAll: false,
      highlights: expect.any(Number),
      stored,
      storedAfterToggle: { ...stored, caseSensitive: true },
    });
    expect(report.hash.highlights).toBeGreaterThanOrEqual(2);
    expect(report.reloaded.phases).toEqual(
      expect.arrayContaining(["idle", "pending", "found"]),
    );
    expect(report.reloaded.result).toEqual({
      current: 1,
      total: 4,
      capped: false,
    });
    expect(report.reloaded.highlights).toBeGreaterThanOrEqual(4);
    expect(report.spinner.pending.length).toBeGreaterThan(0);
    expect(report.spinner.pending.every(Boolean)).toBe(true);
    expect(report.spinner.settled.some(Boolean)).toBe(false);
    expect(report.settings).toEqual({
      opened: "true",
      afterScroller: false,
      afterInput: false,
      afterReopen: false,
    });
  },
  150_000,
);
