import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, it, onTestFailed } from "vitest";

import type { EncodeReport } from "./encode.browser-test.ts";

import {
  runInElectron,
  testElectron,
} from "#__fixtures__/excerpt-image/electron-renderer.ts";

it.skipIf(!testElectron)(
  "encodes lossless WebP through the native canvas path",
  async () => {
    const report = (await runInElectron({
      entry: resolve(import.meta.dirname, "encode.browser-test.ts"),
      name: "excerptEncodeTrial",
      marker: "EXCERPT_ENCODE_RESULT",
      timeoutMs: 60_000,
    })) as EncodeReport;

    const serialized = JSON.stringify(report, null, 2);
    onTestFailed(() => {
      process.stdout.write(`${serialized}\n`);
    });
    const out = process.env.ZOTLIT_WEBP_MEASUREMENTS_OUT;
    if (out) await writeFile(out, `${serialized}\n`, "utf8");

    expect(report.passed).toHaveLength(3);
    expect(report.measurements).toHaveLength(4);
    expect(new Set(report.measurements.map((entry) => entry.crop)).size).toBe(
      4,
    );
    for (const entry of report.measurements) {
      expect(entry.width).toBeGreaterThan(0);
      expect(entry.height).toBeGreaterThan(0);
      expect(entry.pngBytes).toBeGreaterThan(0);
      expect(entry.webpBytes).toBeGreaterThan(0);
      expect(Number.isFinite(entry.pngMs)).toBe(true);
      expect(Number.isFinite(entry.webpMs)).toBe(true);
    }
    const measured = (crop: string) => {
      const entry = report.measurements.find((value) => value.crop === crop);
      if (!entry) throw new Error(`The trial measured no ${crop} crop`);
      return entry;
    };
    for (const crop of ["text", "ink", "image"])
      expect(measured(crop).webpBytes).toBeLessThan(measured(crop).pngBytes);
    const equation = measured("equation");
    expect(equation.webpBytes).toBeLessThanOrEqual(equation.pngBytes * 1.1);
  },
  90_000,
);
