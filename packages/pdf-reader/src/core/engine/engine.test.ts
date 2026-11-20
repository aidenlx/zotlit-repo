import { resolve } from "node:path";
import { expect, it } from "vitest";

import { runInElectron, testElectron } from "@zotlit/scripts/electron-renderer";

import type { EngineReport } from "./engine.browser-test.ts";

import { binaryAssets, readerAlias } from "#test/vite.ts";

it.skipIf(!testElectron)(
  "keeps each engine's fonts apart, decodes JBIG2 and JPX through the embedded wasm, inflates the embedded assets once at the first load, and settles every load as a PdfLoadError",
  async () => {
    const report = (await runInElectron({
      entry: resolve(import.meta.dirname, "engine.browser-test.ts"),
      name: "pdfReaderEngineTrial",
      marker: "PDF_READER_ENGINE_RESULT",
      plugins: [binaryAssets],
      alias: readerAlias,
      timeoutMs: 60_000,
    })) as EngineReport;
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

    expect(report.fonts.a.length).toBeGreaterThan(0);
    expect(report.fonts.b.length).toBeGreaterThan(0);
    expect(report.fonts.a.every((family) => family.startsWith("g_a"))).toBe(
      true,
    );
    expect(report.fonts.b.every((family) => family.startsWith("g_b"))).toBe(
      true,
    );
    expect(report.jbig2.dark).toBeGreaterThan(5000);
    expect(report.jbig2.dark).toBeLessThan(7000);
    expect(report.jpx.gray).toBeGreaterThan(24_000);
    expect(report.failures).toEqual({
      unreadable: "unreadable",
      invalid: "invalid",
      passwordRequired: "password-required",
      passwordIncorrect: "password-incorrect",
      aborted: "aborted",
      afterDispose: "engine-disposed",
    });
    expect(report.interrupted).toEqual({
      disposedDuringRead: "engine-disposed",
      disposedDuringLoad: "engine-disposed",
      abortedDuringLoad: "aborted",
      terminatedOnAbort: true,
      loadAfterAbort: "loaded",
      currentAfterDispose: false,
    });
    expect(report.assets.inflatesAtPluginLoad).toBe(0);
    expect(report.assets.firstInflate?.bytes).toBeGreaterThan(1_000_000);
    expect(report.assets.concurrentFirstLoads).toEqual({
      workers: 1,
      inflates: 1,
    });
  },
  90_000,
);
