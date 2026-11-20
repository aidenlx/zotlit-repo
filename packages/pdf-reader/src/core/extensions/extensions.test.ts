import { resolve } from "node:path";
import { expect, it } from "vitest";

import { runInElectron, testElectron } from "@zotlit/scripts/electron-renderer";

import type { ExtensionsReport } from "./extensions.browser-test.ts";

import { binaryAssets, readerAlias } from "#test/vite.ts";

it.skipIf(!testElectron)(
  "attaches extensions before the read and on a mounted reader, fences a throwing extension off, removes a live extension with its nodes, and reaches the password and failed states",
  async () => {
    const report = (await runInElectron({
      entry: resolve(import.meta.dirname, "extensions.browser-test.ts"),
      name: "pdfReaderExtensionsTrial",
      marker: "PDF_READER_EXTENSIONS_RESULT",
      plugins: [binaryAssets],
      alias: readerAlias,
      timeoutMs: 90_000,
    })) as ExtensionsReport;
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    expect(report.fence.reports).toEqual([
      { extension: "broken", phase: "attach" },
      { extension: "subscriber", phase: "subscribe:state" },
      { extension: "listener", phase: "event:page-rendered" },
    ]);
    expect(report.fence.listenerCalls).toBe(1);
    expect(report.fence.subscriberCalls).toBe(1);
    expect(report.fence.draws).toBeGreaterThanOrEqual(2);
    expect(report.fence.draws).toBeLessThan(1000);
    expect(report.fence.embedOnly).toBe(0);
    expect(report.fence.order).toEqual(["broken", "listener", "after"]);

    const attached = {
      order: ["attach", "read"],
      atAttach: { status: "loading", document: false, rendered: 0 },
      document: false,
      disposed: 0,
    };
    expect(report.status).toEqual({
      encrypted: {
        ...attached,
        final: { status: "password", failure: null, passwordRetry: false },
        queued: "pending",
        ready: "pending",
        settled: true,
      },
      corrupt: {
        ...attached,
        final: {
          status: "failed",
          failure: { reason: "invalid", message: expect.any(String) },
          passwordRetry: false,
        },
        queued: "no-document",
        ready: "null",
        settled: true,
      },
      brokenPage: {
        ...attached,
        final: {
          status: "failed",
          failure: { reason: "invalid", message: expect.any(String) },
          passwordRetry: false,
        },
        queued: "no-document",
        ready: "null",
        settled: true,
      },
    });

    expect(report.live).toEqual({
      attached: [{ subpath: null, document: true, rendered: true }],
      reports: [{ extension: "late-broken", phase: "attach" }],
      embedOnly: 0,
      whileLive: {
        slot: 1,
        drawn: expect.any(Number),
        marks: expect.any(Number),
      },
      removed: { slot: 0, drawn: 0, marks: 0 },
      disposedOnRemove: 1,
      drawsAfterRemove: 0,
      mountedStillDraws: true,
    });
    expect(report.live.whileLive.drawn).toBeGreaterThan(0);
    expect(report.live.whileLive.marks).toBeGreaterThan(0);

    expect(report.disposed).toEqual({
      settled: "AbortError",
      navigate: "no-document",
      ready: "null",
      instanceDisposed: 1,
      statusAfter: "loading",
      rootAttached: false,
    });
  },
  120_000,
);
