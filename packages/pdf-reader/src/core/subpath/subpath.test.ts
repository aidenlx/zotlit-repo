import { resolve } from "node:path";
import { expect, it } from "vitest";

import { runInElectron, testElectron } from "@zotlit/scripts/electron-renderer";

import type { SubpathReport } from "./subpath.browser-test.ts";

import { binaryAssets, readerAlias } from "#test/vite.ts";

it.skipIf(!testElectron)(
  "reads Obsidian's subpath grammar, lands each target with its highlight, and keeps the last navigate before ready",
  async () => {
    const report = (await runInElectron({
      entry: resolve(import.meta.dirname, "subpath.browser-test.ts"),
      name: "pdfReaderSubpathTrial",
      marker: "PDF_READER_SUBPATH_RESULT",
      plugins: [binaryAssets],
      alias: readerAlias,
      timeoutMs: 90_000,
    })) as SubpathReport;
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    const none = {
      page: null,
      offset: null,
      selection: null,
      annotation: null,
      height: null,
      dest: null,
      zoom: null,
      search: null,
    };
    expect(report.parsed).toEqual({
      "#page=3": { ...none, raw: "#page=3", page: 3, params: { page: "3" } },
      "page=3&offset=72,300,0": {
        ...none,
        raw: "page=3&offset=72,300,0",
        page: 3,
        offset: [72, 300, 0],
        params: { page: "3", offset: "72,300,0" },
      },
      "#page=3&offset=,300": {
        ...none,
        raw: "#page=3&offset=,300",
        page: 3,
        params: { page: "3", offset: ",300" },
      },
      "#page=2&selection=1,5,2,10": {
        ...none,
        raw: "#page=2&selection=1,5,2,10",
        page: 2,
        selection: [1, 5, 2, 10],
        params: { page: "2", selection: "1,5,2,10" },
      },
      "#page=4&annotation=5R&selection=0,0,1,3": {
        ...none,
        raw: "#page=4&annotation=5R&selection=0,0,1,3",
        page: 4,
        annotation: "5R",
        params: { page: "4", annotation: "5R", selection: "0,0,1,3" },
      },
      "#chapter-three": {
        ...none,
        raw: "#chapter-three",
        dest: "chapter-three",
        params: {},
      },
      "#zoom=200": {
        ...none,
        raw: "#zoom=200",
        zoom: "200",
        params: { zoom: "200" },
      },
      "#search=fox": {
        ...none,
        raw: "#search=fox",
        search: "fox",
        params: { search: "fox" },
      },
      "#page=2&search=fox&zoom=200": {
        ...none,
        raw: "#page=2&search=fox&zoom=200",
        page: 2,
        params: { page: "2", search: "fox", zoom: "200" },
      },
      "#page=x&height=300&zt-annotation=K&zt-attachment=A": {
        ...none,
        raw: "#page=x&height=300&zt-annotation=K&zt-attachment=A",
        page: 1,
        height: 300,
        params: {
          page: "x",
          height: "300",
          "zt-annotation": "K",
          "zt-attachment": "A",
        },
      },
      "#": { ...none, raw: "#", params: {} },
    });

    expect(report.mount).toEqual({
      context: { page: "2", "zt-annotation": "K", "zt-attachment": "A" },
      pageIndex: 1,
      zoom: "page-width",
      announced: [],
    });
    const pageWidth = report.table["#page=3"]!.scale;
    expect(report.table).toEqual({
      "#page=3": {
        outcome: "shown",
        pageIndex: 2,
        zoom: "page-width",
        scale: pageWidth,
      },
      "#chapter-three": {
        outcome: "shown",
        pageIndex: 2,
        zoom: "page-width",
        scale: pageWidth,
      },
      "#nope": {
        outcome: "unknown-destination",
        pageIndex: 2,
        zoom: "page-width",
        scale: pageWidth,
      },
      "#page=99": {
        outcome: "out-of-range",
        pageIndex: 2,
        zoom: "page-width",
        scale: pageWidth,
      },
      "#zoom=200": { outcome: "shown", pageIndex: 2, zoom: 2, scale: 2 },
      "#search=fox": { outcome: "shown", pageIndex: 2, zoom: 2, scale: 2 },
      "#page=6&zt-annotation=Q&zt-attachment=B": {
        outcome: "shown",
        pageIndex: 5,
        zoom: "page-width",
        scale: expect.closeTo(pageWidth, 10),
      },
      "{dest:chapter-six}": {
        outcome: "shown",
        pageIndex: 5,
        zoom: "page-width",
        scale: expect.closeTo(pageWidth, 10),
      },
      "{pageIndex:6}": {
        outcome: "shown",
        pageIndex: 6,
        zoom: "page-width",
        scale: expect.closeTo(pageWidth, 10),
      },
      "{pageIndex:40}": {
        outcome: "out-of-range",
        pageIndex: 6,
        zoom: "page-width",
        scale: expect.closeTo(pageWidth, 10),
      },
    });

    expect(report.offsets.top).toBeGreaterThan(-20);
    expect(report.offsets.xyz).toBeLessThan(report.offsets.top - 400);
    expect(report.offsets.fitbh).toBeCloseTo(report.offsets.xyz, 0);

    expect(report.selection.marked.split("|").length).toBe(3);
    expect(report.selection.marked).toBe(report.selection.expected);
    expect(report.noSource).toEqual({
      landing: {
        outcome: "shown",
        pageIndex: 1,
        zoom: "page-width",
        scale: expect.closeTo(pageWidth, 10),
      },
      marked: "",
    });
    expect(report.annotation).toEqual({
      boxes: 1,
      textMarks: 0,
      escape: [true, false, 0],
    });

    expect(report.announced).toEqual([
      "#page=3",
      "#chapter-three",
      "#zoom=200",
      "#search=fox",
      "#page=6&zt-annotation=Q&zt-attachment=B",
      "#page=4&offset=0,792,0",
      "#page=4&offset=0,300,0",
      "#page=4&offset=,300",
      "#page=2&selection=2,5,4,10",
      "#page=4&annotation=5R&selection=0,0,1,3",
    ]);
    expect(report.params).toEqual({
      page: "6",
      "zt-annotation": "Q",
      "zt-attachment": "B",
    });
    expect(report.queued).toEqual({
      outcomes: ["superseded", "shown"],
      pageIndex: 4,
      causes: ["restore"],
      announced: ["#page=5"],
    });
    expect(report.ordered).toEqual({
      mountDest: { outcomes: ["shown"], pageIndex: 7, lastBeforeReady: 7 },
      queuedDest: {
        outcomes: ["superseded", "shown"],
        pageIndex: 7,
        lastBeforeReady: 7,
      },
      afterReady: {
        outcomes: ["superseded", "shown"],
        pageIndex: 1,
        lastBeforeReady: null,
      },
    });
  },
  120_000,
);
