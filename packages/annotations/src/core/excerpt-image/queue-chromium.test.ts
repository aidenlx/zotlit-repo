import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, it } from "vitest";

import { readDesktopPaint } from "@zotlit/scripts/desktop-paint";

import type { ChromiumQueueReport } from "./queue-chromium.browser-test.ts";

import {
  runInElectron,
  testElectron,
} from "#__fixtures__/excerpt-image/electron-renderer.ts";

const MAX_COLD_BATCH_MS = 30_000;

it.skipIf(!testElectron)(
  "schedules real Chromium crop work under the admitted bound in a minimized window",
  async (ctx) => {
    const paint = await readDesktopPaint();
    if (paint.state === "cannot paint") {
      ctx.skip(`the desktop cannot paint a window: ${paint.machine}`);
    }
    const report = (await runInElectron({
      entry: resolve(import.meta.dirname, "queue-chromium.browser-test.ts"),
      name: "excerptQueueTrial",
      marker: "EXCERPT_QUEUE_RESULT",
      minimized: true,
      timeoutMs: 120_000,
    })) as ChromiumQueueReport;

    const serialized = JSON.stringify(report, null, 2);
    process.stdout.write(`${serialized}\n`);
    const out = process.env.ZOTLIT_QUEUE_CHROMIUM_MEASUREMENTS_OUT;
    if (out) await writeFile(out, `${serialized}\n`, "utf8");

    expect(report.passed).toEqual([
      "cold batch of canvas crops",
      "cache hit while a render is blocked",
      "teardown before idle",
      "timers under background throttling",
    ]);
    expect(report.visibility).toBe("hidden");
    expect(report.throttledTimers.timerMs).toBeGreaterThanOrEqual(200);
    expect(report.throttledTimers.deadlineMs).toBeGreaterThanOrEqual(200);
    expect(report.cold.excerpts).toBe(130);
    expect(report.cold.renders).toBe(130);
    expect(report.cold.bytes).toBeGreaterThan(0);
    expect(report.cold.peakRenders).toBe(1);
    expect(report.cold.peakAdmitted).toBe(128);
    expect(report.cold.awaitingAtBurst).toBe(2);
    expect(report.cold.totalMs).toBeLessThan(MAX_COLD_BATCH_MS);
    expect(report.cacheHitWhileBlocked.answeredWhileBlocked).toBe(true);
    expect(report.teardown.order).toEqual(["teardown", "idle"]);
  },
  150_000,
);
