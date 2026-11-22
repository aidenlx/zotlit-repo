import type { QueueFixture } from "#__fixtures__/excerpt-image/queue.ts";
import { Effect } from "effect";

import { EXCERPT_JOB_LIMIT } from "./pdf-queue.ts";

import { check } from "#__fixtures__/excerpt-image/check.ts";
import { encodeExcerptImage } from "#__fixtures__/excerpt-image/encode.ts";
import { queueFixture } from "#__fixtures__/excerpt-image/queue.ts";

export interface ChromiumQueueReport {
  passed: string[];
  userAgent: string;
  visibility: string;
  cold: {
    excerpts: number;
    renders: number;
    bytes: number;
    peakRenders: number;
    peakAdmitted: number;
    awaitingAtBurst: number;
    totalMs: number;
  };
  cacheHitWhileBlocked: { hitMs: number; answeredWhileBlocked: boolean };
  teardown: { order: string[] };
  throttledTimers: { timerMs: number; deadlineMs: number };
}

const CROP_WIDTH = 600;
const CROP_HEIGHT = 200;

async function crop(seed: number, signal: AbortSignal): Promise<Uint8Array> {
  const canvas = document.createElement("canvas");
  canvas.width = CROP_WIDTH;
  canvas.height = CROP_HEIGHT;
  const paint = canvas.getContext("2d", { alpha: false });
  if (!paint) throw new Error("Canvas context unavailable");
  paint.fillStyle = "#ffffff";
  paint.fillRect(0, 0, CROP_WIDTH, CROP_HEIGHT);
  paint.fillStyle = "#20242a";
  for (let row = 0; row < 14; row++)
    paint.fillRect(8, 8 + row * 10, CROP_WIDTH - 16 - ((row * seed) % 40), 4);
  paint.strokeStyle = "#b03030";
  paint.lineWidth = 2;
  paint.beginPath();
  paint.moveTo(6, CROP_HEIGHT - 8);
  paint.lineTo(CROP_WIDTH - 6, 12);
  paint.stroke();
  const image = await encodeExcerptImage(canvas, signal);
  return image.bytes;
}

async function cold(queue: QueueFixture): Promise<{
  counts: ChromiumQueueReport["cold"];
  stored: Uint8Array;
}> {
  const excerpts = EXCERPT_JOB_LIMIT + 2;
  const controller = new AbortController();
  let renders = 0;
  let bytes = 0;
  let active = 0;
  let peakRenders = 0;
  let peakAdmitted = 0;
  let stored: Uint8Array | undefined;
  const started = performance.now();
  const producers = Array.from({ length: excerpts }, async (_, index) => {
    const admission = await queue.reserve(controller.signal);
    peakAdmitted = Math.max(peakAdmitted, queue.diagnostics.admitted);
    try {
      const image = await admission.render(
        async () => {
          active += 1;
          peakRenders = Math.max(peakRenders, active);
          try {
            return await crop(index + 1, controller.signal);
          } finally {
            active -= 1;
          }
        },
        {
          pdf: `PDF ${index % 5}`,
          sequence: queue.nextSequence(),
          signal: controller.signal,
        },
      );
      stored ??= image;
      bytes += image.byteLength;
      renders += 1;
    } finally {
      admission.release();
    }
  });
  const awaitingAtBurst = queue.diagnostics.awaiting;
  await Promise.all(producers);
  return {
    counts: {
      excerpts,
      renders,
      bytes,
      peakRenders,
      peakAdmitted,
      awaitingAtBurst,
      totalMs: performance.now() - started,
    },
    stored: stored!,
  };
}

async function cacheHitWhileBlocked(
  queue: QueueFixture,
  stored: Uint8Array,
): Promise<ChromiumQueueReport["cacheHitWhileBlocked"]> {
  const controller = new AbortController();
  const release = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  let finished = false;
  const admission = await queue.reserve(controller.signal);
  const rendering = admission.render(
    async () => {
      started.resolve();
      try {
        await release.promise;
      } finally {
        finished = true;
      }
    },
    {
      pdf: "PDF",
      sequence: queue.nextSequence(),
      signal: controller.signal,
    },
  );
  await started.promise;
  const hit = performance.now();
  const answered = await queue.preflight(async () => stored, controller.signal);
  const hitMs = performance.now() - hit;
  const answeredWhileBlocked = answered.byteLength > 0 && !finished;
  release.resolve();
  await rendering;
  admission.release();
  return { hitMs, answeredWhileBlocked };
}

async function teardown(
  queue: QueueFixture,
): Promise<ChromiumQueueReport["teardown"]> {
  const controller = new AbortController();
  const order: string[] = [];
  const release = Promise.withResolvers<void>();
  const admission = await queue.reserve(controller.signal);
  const rendering = admission.render(
    async () => {
      try {
        await release.promise;
      } finally {
        order.push("teardown");
      }
    },
    {
      pdf: "PDF",
      sequence: queue.nextSequence(),
      signal: controller.signal,
    },
  );
  const idle = queue.idle().then(() => {
    order.push("idle");
  });
  admission.release();
  release.resolve();
  await idle;
  await rendering;
  return { order };
}

async function throttledTimers(): Promise<
  ChromiumQueueReport["throttledTimers"]
> {
  const timerStart = performance.now();
  const timer = new Promise<number>((resolve) => {
    setTimeout(() => resolve(performance.now() - timerStart), 200);
  });
  const deadlineStart = performance.now();
  const deadline = Effect.runPromise(
    Effect.never.pipe(
      Effect.timeout(200),
      Effect.orElseSucceed(() => performance.now() - deadlineStart),
    ),
  );
  const [timerMs, deadlineMs] = await Promise.all([timer, deadline]);
  return { timerMs, deadlineMs };
}

export function run(): Promise<ChromiumQueueReport> {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const queue = yield* queueFixture();
        return yield* Effect.promise(async () => {
          const passed: string[] = [];
          const { userAgent } = navigator;
          const coldBatch = await cold(queue);
          const counts = coldBatch.counts;
          check(
            counts.renders === counts.excerpts,
            "a crop settled per excerpt",
          );
          check(counts.peakRenders === 1, "never two crop renders at once");
          check(
            counts.peakAdmitted === EXCERPT_JOB_LIMIT,
            `the bound of ${EXCERPT_JOB_LIMIT} was reached, not crossed`,
          );
          check(
            counts.awaitingAtBurst === 2,
            "the producers past the bound waited for a slot",
          );
          check(counts.bytes > 0, "the crops encoded to bytes");
          check(
            coldBatch.stored.byteLength > 0,
            "the first crop carried payload bytes",
          );
          check(!queue.busy, "the batch left nothing in flight");
          passed.push("cold batch of canvas crops");

          const cacheHit = await cacheHitWhileBlocked(queue, coldBatch.stored);
          check(
            cacheHit.answeredWhileBlocked,
            "the cache hit answered while the render was still blocked",
          );
          passed.push("cache hit while a render is blocked");

          const idleOrder = await teardown(queue);
          check(
            idleOrder.order.join(" ") === "teardown idle",
            `idle followed teardown: ${idleOrder.order.join(" ")}`,
          );
          passed.push("teardown before idle");

          const throttled = await throttledTimers();
          check(
            Number.isFinite(throttled.timerMs) && throttled.timerMs < 10_000,
            "a scheduled timer still fires while the window is hidden",
          );
          check(
            Number.isFinite(throttled.deadlineMs) &&
              throttled.deadlineMs < 10_000,
            "Effect.timeout still fires while the window is hidden",
          );
          passed.push("timers under background throttling");

          return {
            passed,
            userAgent,
            visibility: document.visibilityState,
            cold: counts,
            cacheHitWhileBlocked: cacheHit,
            teardown: idleOrder,
            throttledTimers: throttled,
          };
        });
      }),
    ),
  );
}
