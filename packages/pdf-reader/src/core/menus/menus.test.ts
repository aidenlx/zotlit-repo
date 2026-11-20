import { regex } from "arkregex";
import { resolve } from "node:path";
import { expect, it } from "vitest";

import { runInElectron, testElectron } from "@zotlit/scripts/electron-renderer";

import type { MenusReport } from "./menus.browser-test.ts";

import { binaryAssets, readerAlias } from "#test/vite.ts";

const SELECTION_LINK = regex("#page=1&selection=(?<at>\\d+),4,\\k<at>,15\\|");

it.skipIf(!testElectron)(
  "copies text, links, annotations, pages and sections from each menu, then adds the extension items",
  async () => {
    const report = (await runInElectron({
      entry: resolve(import.meta.dirname, "menus.browser-test.ts"),
      name: "pdfReaderMenusTrial",
      marker: "PDF_READER_MENUS_RESULT",
      plugins: [binaryAssets],
      alias: readerAlias,
      timeoutMs: 120_000,
    })) as MenusReport;
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    const link = (subpath: string, alias: string) =>
      `[[chrome.pdf${subpath}|chrome, ${alias}]]`;
    const selection = report.text.copied["copy-selection-link"] ?? "";
    const at = SELECTION_LINK.exec(selection)?.groups.at;
    expect(at).toBeDefined();
    const selectionSubpath = `#page=1&selection=${at},4,${at},15`;
    expect(report.text).toEqual({
      ids: ["copy", "copy-as-quote", "copy-selection-link", "probe-text"],
      titles: ["Copy", "Copy as quote", "Copy link to selection", "Probe"],
      copied: {
        copy: "fox and the",
        "copy-as-quote": `> fox and the\n\n${link(selectionSubpath, "page 1")}`,
        "copy-selection-link": link(selectionSubpath, "page 1"),
      },
    });
    expect(report.relanded).toBe("fox and the");

    const highlight = link("#page=2&annotation=9R", "page 2");
    expect(report.annotation).toEqual({
      ids: ["copy-annotation", "copy-annotation-link", "probe-pdf-annotation"],
      titles: ["Copy annotation", "Copy link to annotation", "Probe"],
      copied: {
        "copy-annotation": `> The highlighted sentence on page two.\n\n${highlight}`,
        "copy-annotation-link": highlight,
      },
    });
    expect(report.link).toEqual({
      ids: ["copy-annotation-link", "probe-pdf-annotation"],
      titles: ["Copy link to annotation", "Probe"],
      copied: {
        "copy-annotation-link": link("#page=1&annotation=10R", "page 1"),
      },
    });
    expect(report.page).toEqual({
      ids: ["probe-page"],
      titles: ["Probe"],
      copied: {},
    });
    expect(report.thumbnail).toEqual({
      ids: ["copy-page-link", "probe-thumbnail"],
      titles: ["Copy link to page 2", "Probe"],
      copied: { "copy-page-link": link("#page=2", "page 2") },
    });
    expect(report.outline).toEqual({
      ids: ["copy-section-link", "probe-outline"],
      titles: ["Copy link to “Introduction”", "Probe"],
      copied: {
        "copy-section-link": link("#page=1&offset=72,720,0", "Introduction"),
      },
    });
    expect(report.methods.copied).toEqual({
      "copy-section-link": link("#page=2&offset=72,700", "Methods"),
    });
    expect(report.targets).toEqual([
      `text:fox and the:${selectionSubpath}`,
      "pdf-annotation:0:10R",
      "page:0",
      "pdf-annotation:1:9R",
      "thumbnail:1",
      "outline:Introduction:#page=1&offset=72,720,0",
      "outline:Methods:#page=2&offset=72,700",
    ]);
    expect(report.popup).toEqual({
      contents: "Check this sentence.",
      meta: expect.stringMatching(/^Ada Lovelace · \S/),
      copied: `> The highlighted sentence on page two.\n\n[[chrome.pdf#page=2&annotation=9R]]\n\nCheck this sentence.`,
      escape: true,
      gone: true,
      stale: false,
      optionClosed: true,
      inView: true,
    });
    expect(report.lines).toBe("alpha\nbeta\ngamma");
    expect(report.titled).toEqual([
      {
        title: "Copy link to “1 Introduction ”",
        copied: "[[chrome.pdf#page=1|chrome, 1 Introduction ]]",
      },
      {
        title: "Copy link to “Results and discussion of the experimen…”",
        copied:
          "[[chrome.pdf#page=1|chrome, Results and discussion of the experiment on the reading of PDFs]]",
      },
    ]);
    expect(report.icon).toEqual({
      src: "data:image/svg+xml;base64,",
      alt: "[Note annotation]",
    });
  },
  150_000,
);
