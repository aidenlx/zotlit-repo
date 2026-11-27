import { resolve } from "node:path";
import { expect, it, onTestFailed } from "vitest";

import { runInElectron, testElectron } from "@zotlit/scripts/electron-renderer";

import type { ThemeReport } from "./theme.browser-test.ts";

import { lightness } from "#/core/theme/theme.ts";
import { binaryAssets, readerAlias } from "#test/vite.ts";

it.skipIf(!testElectron)(
  "adapts the page to the theme: a dark host inverts the page colours and keeps the images, a light --pdf-page-background only fills the page, and a theme change repaints",
  async () => {
    const report = (await runInElectron({
      entry: resolve(import.meta.dirname, "theme.browser-test.ts"),
      name: "pdfReaderThemeTrial",
      marker: "PDF_READER_THEME_RESULT",
      plugins: [binaryAssets],
      alias: readerAlias,
      timeoutMs: 90_000,
    })) as ThemeReport;
    onTestFailed(() => {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    });

    expect(report.plain).toMatchObject({
      themed: false,
      inverted: false,
      background: [255, 255, 255],
      rect: [0, 0, 128],
      image: [200, 40, 40],
      fieldFilter: "none",
    });
    expect(lightness(report.plain.ink)).toBeLessThan(60);

    expect(report.dark).toMatchObject({
      themed: true,
      inverted: true,
      background: [30, 30, 30],
      rect: [127, 127, 255],
      image: report.plain.image,
      fieldFilter: "invert(1) hue-rotate(180deg)",
      thumbnail: [30, 30, 30],
      popupBackground: "#262626",
    });
    expect(lightness(report.dark.ink)).toBeGreaterThan(200);

    expect(report.light).toMatchObject({
      themed: true,
      inverted: false,
      background: [244, 236, 216],
      rect: [0, 0, 128],
      image: report.plain.image,
      fieldFilter: "none",
      thumbnail: [244, 236, 216],
    });
    expect(lightness(report.light.ink)).toBeLessThan(60);

    expect(report.unchanged).toEqual({ repainted: false });
    for (const sample of [report.plain, report.light, report.off]) {
      expect(sample.popupBackground).not.toBe(report.dark.popupBackground);
    }

    expect(report.off).toMatchObject({
      themed: false,
      inverted: false,
      background: [255, 255, 255],
      rect: [0, 0, 128],
      thumbnail: [255, 255, 255],
    });
  },
  120_000,
);
