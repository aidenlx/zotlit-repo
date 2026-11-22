import { usableExcerptWebpPixels } from "./webp-pixels.ts";
import { usableExcerptWebp } from "./webp.ts";

import { check } from "#__fixtures__/excerpt-image/check.ts";
import {
  chromiumLosslessWebp,
  sizedWebp,
} from "#__fixtures__/excerpt-image/webp.ts";

export interface WebpPixelsReport {
  passed: string[];
}

export async function run(): Promise<WebpPixelsReport> {
  const passed: string[] = [];
  const headerOnly = sizedWebp(8, 8);
  check(
    usableExcerptWebp(headerOnly),
    "The header-only fixture must pass the structural check this trial deepens",
  );
  check(
    !(await usableExcerptWebpPixels(headerOnly)),
    "The renderer's decoder accepted a payload that carries no pixel data",
  );
  passed.push("header-only payload refused");

  check(
    await usableExcerptWebpPixels(chromiumLosslessWebp),
    "The renderer's decoder refused real lossless WebP output",
  );
  passed.push("lossless payload accepted");

  return { passed };
}
