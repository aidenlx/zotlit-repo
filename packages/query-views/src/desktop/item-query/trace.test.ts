import { it } from "@effect/vitest";
import { Effect, Exit, Fiber, Scheduler } from "effect";
import { createHook } from "node:async_hooks";
import { describe, expect } from "vitest";

import { ItemQueryStatementObserver } from "@zotlit/db/item-query";
import type { ItemQueryReader } from "@zotlit/db/item-query";
import { ItemQueryScheduler } from "@zotlit/item-query";

import { createTrace, finishTrace } from "./trace.ts";

function clock() {
  let now = 0;
  let scheduledWait: number | undefined;
  const waits = new Map<number, number>();
  const hook = createHook({
    init: (id, type) => {
      if (type === "Immediate" && scheduledWait !== undefined) {
        waits.set(id, scheduledWait);
        scheduledWait = undefined;
      }
    },
    before: (id) => {
      now += waits.get(id) ?? 0;
      waits.delete(id);
    },
  }).enable();

  return {
    now: () => now,
    work: (ms: number) => {
      now += ms;
    },
    wait: (ms: number) => {
      scheduledWait = ms;
      return new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
    },
    [Symbol.dispose]: () => {
      hook.disable();
    },
  };
}

const onScheduler =
  (options: ConstructorParameters<typeof ItemQueryScheduler>[0]) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.provideService(
      effect,
      Scheduler.Scheduler,
      new ItemQueryScheduler(options),
    );

const reportOf = (trace: ReturnType<typeof createTrace>, startedAt = 0) =>
  finishTrace(trace, {
    startedAt,
    answerSteps: [],
  });

describe("Item Query execution slices", () => {
  it.live.each([60, 600])(
    "keeps a %i ms asynchronous wait out of execution slices",
    (waitMs) =>
      Effect.gen(function* () {
        const time = yield* Effect.acquireDisposable(Effect.sync(clock));
        const trace = createTrace(false, time.now);
        yield* trace
          .instrument(
            Effect.gen(function* () {
              yield* Effect.sync(() => time.work(2));
              yield* Effect.promise(() => time.wait(waitMs));
              yield* Effect.sync(() => time.work(3));
            }),
          )
          .pipe(onScheduler({ budgetMs: 8, now: time.now }));
        const report = reportOf(trace);
        expect(report.engineMs).toBe(waitMs + 5);
        expect(report.slices.filter((ms) => ms > 0)).toEqual([2, 3]);
      }),
  );

  it.live("keeps a synchronous stall in its execution slice", () =>
    Effect.gen(function* () {
      const time = yield* Effect.acquireDisposable(Effect.sync(clock));
      const trace = createTrace(false, time.now);
      yield* trace
        .instrument(Effect.sync(() => time.work(60)))
        .pipe(onScheduler({ budgetMs: 8, now: time.now }));
      expect(Math.max(...reportOf(trace).slices)).toBe(60);
    }),
  );

  it.live(
    "measures synchronous work in a Promise continuation before Effect resumes",
    () =>
      Effect.gen(function* () {
        const time = yield* Effect.acquireDisposable(Effect.sync(clock));
        const trace = createTrace(false, time.now);
        yield* trace
          .instrument(
            Effect.promise(async () => {
              await time.wait(600);
              time.work(60);
            }),
          )
          .pipe(onScheduler({ budgetMs: 8, now: time.now }));
        const report = reportOf(trace);
        expect(report.engineMs).toBe(660);
        expect(report.slices.filter((ms) => ms > 0)).toEqual([60]);
      }),
  );

  it.live(
    "measures each overlapping job's work and statements",
    ({ annotate }) =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          annotate(
            "https://github.com/aidenlx/zotlit-repo/issues/150",
            "issue",
          ),
        );
        const time = yield* Effect.acquireDisposable(Effect.sync(clock));
        const gateA = Promise.withResolvers<void>();
        const gateB = Promise.withResolvers<void>();
        const nowB = () => time.now() + 1_000;
        const start = (
          trace: ReturnType<typeof createTrace>,
          gate: Promise<void>,
          work: {
            reader: ItemQueryReader;
            beforeWait: number;
            continuation: number;
            afterWait: number;
          },
        ) =>
          trace
            .instrument(
              Effect.gen(function* () {
                const observe = yield* ItemQueryStatementObserver;
                yield* Effect.sync(() => time.work(work.beforeWait));
                yield* Effect.promise(async () => {
                  await gate;
                  time.work(work.continuation);
                });
                yield* Effect.sync(() => {
                  time.work(work.afterWait);
                  observe({ reader: work.reader, params: {}, rows: [1] });
                });
              }),
            )
            .pipe(
              onScheduler({ budgetMs: Infinity, now: time.now }),
              Effect.forkChild({ startImmediately: true }),
            );
        const traceA = createTrace(false, time.now);
        const startedB = nowB();
        const traceB = createTrace(false, nowB);
        const jobA = yield* start(traceA, gateA.promise, {
          reader: "scan-page",
          beforeWait: 2,
          continuation: 7,
          afterWait: 3,
        });
        const jobB = yield* start(traceB, gateB.promise, {
          reader: "hydrate-chunk",
          beforeWait: 5,
          continuation: 17,
          afterWait: 4,
        });

        yield* Effect.promise(
          () =>
            new Promise<void>((resolve) => {
              setImmediate(() => {
                time.work(70);
                gateA.resolve();
                queueMicrotask(() => time.work(40));
                gateB.resolve();
                resolve();
              });
            }),
        );
        yield* Fiber.join(jobA);
        yield* Fiber.join(jobB);

        const reportA = reportOf(traceA);
        const reportB = reportOf(traceB, startedB);
        expect(reportA.slices.filter((ms) => ms > 0)).toEqual([2, 10]);
        expect(reportB.slices.filter((ms) => ms > 0)).toEqual([5, 21]);
        expect(reportA.worstSlice?.statements).toEqual([
          { reader: "scan-page", rows: 1 },
        ]);
        expect(reportB.worstSlice?.statements).toEqual([
          { reader: "hydrate-chunk", rows: 1 },
        ]);
        expect(reportA.statements).toEqual({
          "scan-page": { count: 1, rows: 1, maxRows: 1, longestSliceMs: 10 },
        });
        expect(reportB.statements).toEqual({
          "hydrate-chunk": {
            count: 1,
            rows: 1,
            maxRows: 1,
            longestSliceMs: 21,
          },
        });
      }),
  );

  it.live(
    "keeps promise microtasks in one slice until the scheduler releases the host",
    () =>
      Effect.gen(function* () {
        const time = yield* Effect.acquireDisposable(Effect.sync(clock));
        const trace = createTrace(false, time.now);
        yield* trace
          .instrument(
            Effect.gen(function* () {
              for (let i = 0; i < 6; i++) {
                yield* Effect.sync(() => time.work(3));
                yield* Effect.promise(() => Promise.resolve());
              }
            }),
          )
          .pipe(onScheduler({ budgetMs: 8, now: time.now }));
        expect(reportOf(trace).slices.filter((ms) => ms > 0)).toEqual([9, 9]);
      }),
  );

  it.live(
    "ends a slice at a scheduler pause that async_hooks does not report",
    () =>
      Effect.gen(function* () {
        const time = yield* Effect.acquireDisposable(Effect.sync(clock));
        const trace = createTrace(false, time.now);
        yield* trace
          .instrument(
            Effect.gen(function* () {
              for (let i = 0; i < 6; i++)
                yield* Effect.sync(() => time.work(3));
            }),
          )
          .pipe(
            onScheduler({
              now: time.now,
              budgetMs: 8,
              pause: (resume) => {
                queueMicrotask(resume);
                return () => {};
              },
            }),
          );
        const report = reportOf(trace);
        expect(report.pauses).toBe(2);
        expect(report.slices.filter((ms) => ms > 0)).toEqual([9, 9]);
      }),
  );

  it.live(
    "ends a cancelled wait without counting the wait as synchronous work",
    () =>
      Effect.gen(function* () {
        const time = yield* Effect.acquireDisposable(Effect.sync(clock));
        const trace = createTrace(false, time.now);
        const run: Fiber.Fiber<void> = yield* Effect.forkChild(
          trace
            .instrument(
              Effect.gen(function* () {
                yield* Effect.sync(() => time.work(2));
                yield* Effect.promise(async () => {
                  await time.wait(100);
                  run.interruptUnsafe();
                });
              }),
            )
            .pipe(onScheduler({ budgetMs: 8, now: time.now })),
        );
        const exit = yield* Fiber.await(run);
        expect(Exit.hasInterrupts(exit)).toBe(true);
        const report = reportOf(trace);
        expect(report.engineMs).toBe(102);
        expect(report.slices.filter((ms) => ms > 0)).toEqual([2]);
      }),
  );
});
