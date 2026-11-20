import { resolve } from "node:path";
import { expect, it } from "vitest";

import { runInElectron, testElectron } from "@zotlit/scripts/electron-renderer";

import type { ChromeReport } from "./chrome.browser-test.ts";

import { binaryAssets, readerAlias } from "#test/vite.ts";

it.skipIf(!testElectron)(
  "asks for a password in the reader, drives the toolbar, thumbnails and outline, and zooms at the cursor of the wheel",
  async () => {
    const report = (await runInElectron({
      entry: resolve(import.meta.dirname, "chrome.browser-test.ts"),
      name: "pdfReaderChromeTrial",
      marker: "PDF_READER_CHROME_RESULT",
      plugins: [binaryAssets],
      alias: readerAlias,
      timeoutMs: 120_000,
    })) as ChromeReport;
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

    expect(report.password).toEqual({
      asked: { status: "password", passwordRetry: false },
      promptShown: true,
      message: "Enter the password below",
      focused: true,
      wrong: { status: "password", passwordRetry: true },
      wrongMessage: "Invalid password",
      right: { status: "ready", pageCount: 1 },
      promptGone: true,
      reloadStatuses: ["loading", "ready"],
      cancelled: {
        status: "failed",
        failure: {
          reason: "password-cancelled",
          message: expect.any(String),
        },
      },
      cancelledReady: null,
      cancelledNavigate: "no-document",
      cancelledRender: null,
      error: "The PDF stays closed because it needs a password.",
      reloadAfterCancel: { status: "password", passwordRetry: false },
      reloadMessage: "Enter the password below",
    });

    expect(report.toolbar).toEqual({
      labelInput: { type: "text", value: "i" },
      labelCount: "(1 of 3)",
      typedLabel: 2,
      numberInput: { type: "number", value: "3" },
      numberCount: "of 3",
      zoomIn: { scale: 10, disabled: true },
      zoomOut: { scale: 0.1, disabled: true },
      wheel: {
        before: 1,
        after: report.toolbar.wheel.after,
        zoom: report.toolbar.wheel.after,
        scrolled: true,
        locked: true,
        lockedScale: report.toolbar.wheel.after,
      },
      displayMenu: [
        "fit-width",
        "fit-height",
        "spread-none",
        "spread-odd",
        "spread-even",
        "themed",
        "page-labels",
      ],
      sidebarMenu: [
        { id: "thumbnails", checked: false },
        { id: "outline", checked: false, disabled: false },
        { id: "reveal-in-outline", disabled: false },
      ],
      spread: "odd",
      themed: { state: true, rootClass: true },
    });

    expect(report.sidebar).toEqual({
      open: true,
      closedDisplay: "none",
      thumbnails: 3,
      painted: expect.any(Number),
      labels: ["i", "1", "2"],
      pressed: { pageIndex: 1, cause: "navigate" },
      current: "2",
      outline: ["Introduction", "Methods", "Project site"],
      flairs: ["i", "1", ""],
      revealed: "Sampling",
      url: ["https://example.org/zotlit"],
      dragging: { stored: 140, shown: 220 },
      dragged: { stored: 220, state: 220 },
      names: ["Page i", "Page 1", "Page 2"],
      toggles: [{ label: "Collapse section", expanded: "true" }],
      reactivated: false,
      keyboard: [
        236,
        220,
        204,
        140,
        report.sidebar.keyboard[5],
        report.sidebar.keyboard[5],
      ],
      unlabelled: {
        flairs: ["1", "2", ""],
        thumbnails: ["1:Page 1", "2:Page 2", "3:Page 3"],
      },
    });
    expect(report.clamped.main).toBeGreaterThan(0);
    expect(report.clamped.scroller).toBeGreaterThan(0);
    expect(report.contained.outer).toEqual([0, 0, 0]);
    expect(report.contained.list).toBeGreaterThan(0);
    expect(report.lockout).toEqual({ beforeDeadline: 0, afterDeadline: 1 });
    expect(report.thumbnailRatios).toHaveLength(2);
    for (const { box, bitmap } of report.thumbnailRatios) {
      expect(box).toBeCloseTo(bitmap, 1);
    }
    expect(report.sidebar.painted).toBeGreaterThan(0);
    expect(report.toolbar.wheel.after).toBeGreaterThan(1);
    expect(report.wheelOrigin.offset.top).toBeGreaterThan(180);
    expect(report.wheelOrigin.after).toBeGreaterThan(report.wheelOrigin.before);
    expect(Math.abs(report.wheelOrigin.drift.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(report.wheelOrigin.drift.y)).toBeLessThanOrEqual(2);
  },
  150_000,
);
