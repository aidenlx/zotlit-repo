import { Effect } from "effect";

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
  heapBefore: number | undefined;
  heapUsed: (() => number) | undefined;
}

export interface HostCallbackHooks {
  readonly init: (id: number, type: string) => void;
  readonly before: (id: number, job: symbol | undefined) => void;
  readonly after: (id: number) => void;
  readonly destroy: (id: number) => void;
}

export interface AsyncContext {
  readonly current: () => symbol | undefined;
  readonly run: <A>(job: symbol, evaluate: () => A) => A;
  readonly enable: () => void;
  readonly disable: () => void;
}

export interface QueryMeter {
  readonly asyncContext?: (hooks: HostCallbackHooks) => AsyncContext;
  readonly heapUsed?: () => number;
}

interface MeterState {
  readonly asyncJob: AsyncContext;
  readonly running: Map<
    symbol,
    { now: () => number; slice: () => ExecutionSlice }
  >;
  readonly hostCallbacks: Set<number>;
  readonly callbacks: { id: number; previousJob: symbol | undefined }[];
  readonly hostTurn: () => number;
  readonly activeJob: () => symbol | undefined;
  readonly switchJob: (job: symbol | undefined) => symbol | undefined;
}

const noAsyncContext: AsyncContext = {
  current: () => undefined,
  run: (_job, evaluate) => evaluate(),
  enable: () => {},
  disable: () => {},
};

function makeMeterState(meter: QueryMeter): MeterState {
  const running: MeterState["running"] = new Map();
  const hostCallbacks = new Set<number>();
  const callbacks: MeterState["callbacks"] = [];
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

  const hooks: HostCallbackHooks = {
    init: (id, type) => {
      if (type !== "PROMISE" && type !== "Microtask" && type !== "TickObject")
        hostCallbacks.add(id);
    },
    before: (id, job) => {
      if (callbacks.length === 0 && hostCallbacks.has(id)) hostTurn++;
      callbacks.push({ id, previousJob: switchJob(job) });
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
  };

  return {
    asyncJob: meter.asyncContext?.(hooks) ?? noAsyncContext,
    running,
    hostCallbacks,
    callbacks,
    hostTurn: () => hostTurn,
    activeJob: () => active?.job,
    switchJob,
  };
}

const meterStates = new WeakMap<QueryMeter, MeterState>();

function meterStateOf(meter: QueryMeter): MeterState {
  let state = meterStates.get(meter);
  if (!state) {
    state = makeMeterState(meter);
    meterStates.set(meter, state);
  }
  return state;
}

export function createTrace(
  meter: QueryMeter,
  sampleHeap: boolean,
  now: () => number,
): Trace {
  const state = meterStateOf(meter);
  const { asyncJob, running, switchJob } = state;
  const { heapUsed } = meter;
  const job = Symbol();
  let currentSlice: ExecutionSlice | undefined;
  let sliceTurn = state.hostTurn();
  const jobSlice = () => {
    if (!currentSlice || sliceTurn !== state.hostTurn()) {
      currentSlice = { ms: 0, statements: [] };
      sliceTurn = state.hostTurn();
      trace.slices.push(currentSlice);
    }
    return currentSlice;
  };
  const sample =
    sampleHeap && heapUsed
      ? () => trace.heapSamples.push(heapUsed())
      : () => {};
  const trace: Trace = {
    now,
    heapBefore: sampleHeap ? heapUsed?.() : undefined,
    heapUsed: sampleHeap ? heapUsed : undefined,
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
        if (running.size === 0) asyncJob.enable();
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
              return asyncJob.current() === job
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
            if (state.activeJob() === job) switchJob(undefined);
            running.delete(job);
            if (running.size === 0) {
              asyncJob.disable();
              state.callbacks.length = 0;
              state.hostCallbacks.clear();
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
            const insideJob = state.activeJob() === job;
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
  context: { startedAt: number; answerSteps: number[] },
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
      trace.heapBefore === undefined || trace.heapUsed === undefined
        ? undefined
        : {
            beforeBytes: trace.heapBefore,
            peakBytes: Math.max(trace.heapBefore, ...trace.heapSamples),
            afterAnswerBytes: trace.heapUsed(),
            samples: trace.heapSamples.length,
          },
  };
  measured.workerMs = trace.now() - context.startedAt;
  return measured;
}
