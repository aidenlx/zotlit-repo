import { resolve } from "node:path";
import { expect, it } from "vitest";

import type { WebpPixelsReport } from "./webp-pixels.browser-test.ts";

import {
  runInElectron,
  testElectron,
} from "#__fixtures__/excerpt-image/electron-renderer.ts";

it.skipIf(!testElectron)(
  "refuses a vault WebP whose pixel data the renderer's decoder cannot reconstruct",
  async () => {
    const report = (await runInElectron({
      entry: resolve(import.meta.dirname, "webp-pixels.browser-test.ts"),
      name: "excerptWebpPixelsTrial",
      marker: "EXCERPT_WEBP_PIXELS_RESULT",
      timeoutMs: 60_000,
    })) as WebpPixelsReport;

    expect(report.passed).toEqual([
      "header-only payload refused",
      "lossless payload accepted",
    ]);
  },
  90_000,
);
