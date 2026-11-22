import { Effect } from "effect";
import { AsyncLocalStorage, createHook } from "node:async_hooks";

import { ItemQueryStatementObserver } from "@zotlit/db/item-query";
import type { ItemQueryReader } from "@zotlit/db/item-query";
import { ItemQuerySliceObserver } from "@zotlit/item-query";

import type { QueryInstrument } from "./answer.ts";

export interface CancellationEvent {
  phase:
    | "requested"
    | "sent"
    | "received"
    | "accepted"
    | "write-finished"
    | "files-closed"
    | "resources-closed"
    | "receipt"
    | "stop-requested"
    | "exit"
    | "cleanup-finished";
  atEpochMs: number;
}

export interface QueryObserver {
  completed: (report: WorkerMeasurement) => void;
  cancelled?: (event: CancellationEvent) => void;
}

interface ExecutionSlice {
  ms: number;
  statements: { reader: ItemQueryReader; rows: number }[];
}

export interface Trace {
  now: () => number;
  instrument: QueryInstrument;
  engineStart: number | undefined;
  engineEnd: number | undefined;
  paused: number[];
  resumed: number[];
  slices: ExecutionSlice[];
  heapSamples: number[];
}

const asyncJob = new AsyncLocalStorage<symbol>();
const running = new Map<
  symbol,
  { now: () => number; slice: () => ExecutionSlice }
>();
const hostCallbacks = new Set<number>();
const callbacks: { id: number; previousJob: symbol | undefined }[] = [];
let hostTurn = 0;
let active:
  | { job: symbol; now: () => number; start: number; slice: ExecutionSlice }
  | undefined;

function switchJob(job: symbol | undefined): symbol | undefined {
  const previousJob = active?.job;
  if (previousJob === job) return previousJob;
  if (active) active.slice.ms += active.now() - active.start;
  const meter = job === undefined ? undefined : running.get(job);
  active =
    job !== undefined && meter
      ? { job, now: meter.now, start: meter.now(), slice: meter.slice() }
      : undefined;
  return previousJob;
}

const hook = createHook({
  init: (id, type) => {
    if (type !== "PROMISE" && type !== "Microtask" && type !== "TickObject")
      hostCallbacks.add(id);
  },
  before: (id) => {
    if (callbacks.length === 0 && hostCallbacks.has(id)) hostTurn++;
    callbacks.push({ id, previousJob: switchJob(asyncJob.getStore()) });
  },
  after: (id) => {
    const callback = callbacks.at(-1);
    if (callback?.id !== id) return;
    callbacks.pop();
    switchJob(callback.previousJob);
  },
  destroy: (id) => {
    hostCallbacks.delete(id);
  },
});

export function createTrace(sampleHeap: boolean, now: () => number): Trace {
  const job = Symbol();
  let currentSlice: ExecutionSlice | undefined;
  let sliceTurn = hostTurn;
  const jobSlice = () => {
    if (!currentSlice || sliceTurn !== hostTurn) {
      currentSlice = { ms: 0, statements: [] };
      sliceTurn = hostTurn;
      trace.slices.push(currentSlice);
    }
    return currentSlice;
  };
  const sample = sampleHeap
    ? () => trace.heapSamples.push(process.memoryUsage().heapUsed)
    : () => {};
  const trace: Trace = {
    now,
    engineStart: undefined,
    engineEnd: undefined,
    paused: [],
    resumed: [],
    slices: [],
    heapSamples: [],
    instrument: (operation) =>
      Effect.gen(function* () {
        trace.engineStart = now();
        sample();
        if (running.size === 0) hook.enable();
        running.set(job, { now, slice: jobSlice });
        const tracer = yield* Effect.tracer;
        return yield* Effect.withTracer(operation, {
          span: (options) => tracer.span(options),
          context: (primitive, fiber) => {
            const evaluate = () =>
              tracer.context
                ? tracer.context(primitive, fiber)
                : primitive["~effect/Effect/evaluate"](fiber);
            const previousJob = switchJob(job);
            try {
              return asyncJob.getStore() === job
                ? evaluate()
                : asyncJob.run(job, evaluate);
            } finally {
              switchJob(previousJob);
            }
          },
        });
      }).pipe(
        Effect.onExit(() =>
          Effect.sync(() => {
            trace.engineEnd = now();
            sample();
            if (active?.job === job) switchJob(undefined);
            running.delete(job);
            if (running.size === 0) {
              hook.disable();
              callbacks.length = 0;
              hostCallbacks.clear();
            }
          }),
        ),
        Effect.provideService(ItemQuerySliceObserver, {
          paused: () => {
            trace.paused.push(now());
            sample();
          },
          resumed: () => {
            trace.resumed.push(now());
            const insideJob = active?.job === job;
            if (insideJob) switchJob(undefined);
            currentSlice = undefined;
            if (insideJob) switchJob(job);
          },
        }),
        Effect.provideService(ItemQueryStatementObserver, (run) => {
          jobSlice().statements.push({
            reader: run.reader,
            rows: run.rows.length,
          });
        }),
      ),
  };
  return trace;
}

export interface WorkerMeasurement {
  workerMs: number;
  engineMs?: number;
  answerMs?: number;
  channels?: { created: number; closed: number; open: number };
  answerSteps: number[];
  slices: number[];
  worstSlice?: {
    ms: number;
    index: number;
    statements: { reader: ItemQueryReader; rows: number }[];
  };
  pauses: number;
  longestPauseMs: number;
  statements: Partial<
    Record<
      ItemQueryReader,
      { count: number; rows: number; maxRows: number; longestSliceMs: number }
    >
  >;
  heap?: {
    beforeBytes: number;
    peakBytes: number;
    afterAnswerBytes: number;
    samples: number;
  };
}

export function finishTrace(
  trace: Trace,
  context: { startedAt: number; answerSteps: number[]; heapBefore?: number },
): WorkerMeasurement {
  const finishedAt = trace.now();
  const { slices } = trace;
  let worstIndex = -1;
  const statements: WorkerMeasurement["statements"] = {};
  for (const [index, slice] of slices.entries()) {
    if (worstIndex < 0 || slice.ms > slices[worstIndex]!.ms) worstIndex = index;
    for (const { reader, rows } of slice.statements) {
      const total = (statements[reader] ??= {
        count: 0,
        rows: 0,
        maxRows: 0,
        longestSliceMs: 0,
      });
      total.count++;
      total.rows += rows;
      total.maxRows = Math.max(total.maxRows, rows);
      total.longestSliceMs = Math.max(total.longestSliceMs, slice.ms);
    }
  }
  const worst = slices[worstIndex];
  const measured: WorkerMeasurement = {
    workerMs: finishedAt - context.startedAt,
    engineMs:
      trace.engineStart === undefined || trace.engineEnd === undefined
        ? undefined
        : trace.engineEnd - trace.engineStart,
    answerMs: context.answerSteps.reduce((total, ms) => total + ms, 0),
    answerSteps: context.answerSteps,
    slices: slices.map(({ ms }) => ms),
    worstSlice: worst
      ? {
          ms: worst.ms,
          index: worstIndex,
          statements: worst.statements,
        }
      : undefined,
    pauses: trace.paused.length,
    longestPauseMs: Math.max(
      0,
      ...trace.resumed.map((at, index) => at - trace.paused[index]!),
    ),
    statements,
    heap:
      context.heapBefore === undefined
        ? undefined
        : {
            beforeBytes: context.heapBefore,
            peakBytes: Math.max(context.heapBefore, ...trace.heapSamples),
            afterAnswerBytes: process.memoryUsage().heapUsed,
            samples: trace.heapSamples.length,
          },
  };
  measured.workerMs = trace.now() - context.startedAt;
  return measured;
}
