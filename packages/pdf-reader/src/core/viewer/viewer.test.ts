import { resolve } from "node:path";
import { expect, it } from "vitest";

import { runInElectron, testElectron } from "@zotlit/scripts/electron-renderer";

import type { ViewerReport } from "./viewer.browser-test.ts";

import { binaryAssets, readerAlias } from "#test/vite.ts";

it.skipIf(!testElectron)(
  "paints pages with their text layer, keeps extension layers across wipes, and names each page change's cause",
  async () => {
    const report = (await runInElectron({
      entry: resolve(import.meta.dirname, "viewer.browser-test.ts"),
      name: "pdfReaderViewerTrial",
      marker: "PDF_READER_VIEWER_RESULT",
      plugins: [binaryAssets],
      alias: readerAlias,
      timeoutMs: 90_000,
    })) as ViewerReport;
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

    expect(report.textLayer.pages).toBe(1);
    expect(report.textLayer.textLayers).toBe(1);
    expect(report.textLayer.text.length).toBeGreaterThan(0);
    expect(report.textLayer.text).toBe(report.textLayer.expected);

    expect(report.rotated).toEqual(
      Array.from({ length: 10 }, () => ({ settled: 1, zoomed: 1 })),
    );
    expect(report.layers.draws).toBeGreaterThanOrEqual(2);
    expect(report.layers.draws).toBe(report.layers.renders);
    expect(report.layers).toMatchObject({
      sameAbove: true,
      sameBelow: true,
      aboveAfterText: true,
      belowBeforeText: true,
      belowAfterCanvas: true,
      marker: true,
      scale: 2,
    });

    expect(report.rendered.events).toBeGreaterThanOrEqual(2);
    expect(report.rendered.allJoined).toBe(true);
    expect(report.rendered.renderedPages).toContain(0);
    expect(report.rendered.early).toEqual(["page", "null"]);
    expect(report.rendered.failed).toEqual(["null", "null"]);

    expect(report.causes.first).toEqual([
      { pageIndex: 4, previous: 0, cause: "user" },
    ]);
    expect(report.causes.reopened).toEqual([
      { pageIndex: 3, previous: 0, cause: "restore" },
      { pageIndex: 4, previous: 3, cause: "restore" },
    ]);
    expect(report.causes.reopenedAt).toBe(4);
    expect(report.causes.named).toEqual([
      { pageIndex: 1, previous: 0, cause: "navigate" },
    ]);
    expect(report.causes.position).toEqual({
      pageIndex: 4,
      subpath: "#page=5",
    });
    expect(report.causes.navigated).toEqual([
      { pageIndex: 1, previous: 4, cause: "navigate" },
    ]);
    expect(report.causes.scrolled.length).toBeGreaterThan(0);
    expect(report.causes.scrolled.every(({ cause }) => cause === "user")).toBe(
      true,
    );

    expect(report.reload).toEqual({
      events: [
        "document",
        "ready:true",
        "document:null",
        "document",
        "ready:false",
      ],
      oldCurrent: false,
      newCurrent: true,
      pendingRender: "null",
      disposed: 0,
      attached: 1,
      pageIndex: [2, 2],
      scale: [
        report.reload.scale[0],
        expect.closeTo(report.reload.scale[0], 10),
      ],
      reads: 3,
      slotKept: true,
      migrated: ["document:null", "window-migrated", "document", "ready:false"],
      migratedPage: 2,
    });
    expect(report.deferred).toEqual({
      readsHidden: 0,
      statusHidden: "loading",
      readsShown: 1,
      ready: true,
    });

    const [start, afterOne, afterAll] = report.redraw.scrollTop;
    expect(start).toBeGreaterThan(0);
    expect(afterOne).toBe(start);
    expect(afterAll).toBe(start);
    expect(report.redraw.changes).toBe(0);
    expect(report.redraw.repainted[0]).toBe(1);
    expect(report.redraw.repainted.length).toBeGreaterThan(1);
    expect(report.redraw.settled).toBe(true);

    expect(report.popout.ready).toBe(true);
    expect(report.popout.frameFonts).toBeGreaterThan(0);
    expect(report.popout.mainFonts).toBe(0);
    expect(report.popout.movedTo).toBe(true);
    expect(report.popout.movedPage).toBe(2);
  },
  120_000,
);
