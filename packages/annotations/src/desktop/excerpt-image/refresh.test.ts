import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, it, onTestFailed } from "vitest";

import type { RefreshReport } from "./refresh.browser-test.ts";

import {
  runInElectron,
  testElectron,
} from "#__fixtures__/excerpt-image/electron-renderer.ts";

const HOST = resolve(
  import.meta.dirname,
  "../../__fixtures__/excerpt-image/renderer-host.ts",
);

const ALIAS = {
  "node:crypto": resolve(
    import.meta.dirname,
    "../../__fixtures__/excerpt-image/renderer-hash.ts",
  ),
  "node:fs/promises": HOST,
  "node:zlib": HOST,
  "@zotlit/item-query": HOST,
  "@zotlit/db/path": HOST,
  "@zotlit/db/client/node": HOST,
  "@zotlit/db": HOST,
  obsidian: HOST,
};

it.skipIf(!testElectron)(
  "refreshes, restarts, evicts, and clears over Chromium's IndexedDB",
  async () => {
    const report = (await runInElectron({
      entry: resolve(import.meta.dirname, "refresh.browser-test.ts"),
      name: "excerptRefreshTrial",
      marker: "EXCERPT_REFRESH_RESULT",
      alias: ALIAS,
      timeoutMs: 120_000,
    })) as RefreshReport;

    const serialized = JSON.stringify(report, null, 2);
    onTestFailed(() => {
      process.stdout.write(`${serialized}\n`);
    });
    const out = process.env.ZOTLIT_REFRESH_MEASUREMENTS_OUT;
    if (out) await writeFile(out, `${serialized}\n`, "utf8");

    expect(report.passed).toEqual([
      "one resolution over the real store",
      "inactive replacement through the shared queue",
      "restart paints the stored image, then replaces it",
      "eviction, references, and image byte accounting",
      "clear races with running and queued crop work",
    ]);
    expect(report.bytes.retained).toBeLessThanOrEqual(report.bytes.budget);
    expect(report.references).toBe(40);
    expect(report.queue.limit).toBe(128);
    expect(report.queue.admitted).toBe(0);
    expect(report.queue.awaiting).toBe(0);
  },
  180_000,
);
