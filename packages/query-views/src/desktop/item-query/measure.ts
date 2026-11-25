import { Cause, Clock, Effect, Exit, Fiber, Layer, Schema } from "effect";
import type { CliData, CliFlags } from "obsidian";

import type { ItemQueryReader } from "@zotlit/db/item-query";
import type { CliHost } from "@zotlit/obsidian-kit/cli-command.ts";
import {
  cliMap,
  cliParams,
  cliSwitch,
  decodeCliParams,
  rejectionText,
} from "@zotlit/obsidian-kit/cli-params.ts";
import type {
  CliOutput,
  CliRejection,
} from "@zotlit/obsidian-kit/cli-params.ts";
import { PluginHost } from "@zotlit/obsidian-kit/plugin-host.ts";
import { monotonicMillis } from "@zotlit/plugin-kernel/worker/effect-clock.ts";

import { queryFlags } from "./contract.ts";
import { decodeQuery } from "./decode.ts";
import { QueryService } from "./service.ts";
import type { CancellationEvent, WorkerMeasurement } from "./trace.ts";

export const QUERY_MEASURE_COMMAND = "zotlit:query-measure" as const;

const queryMeasureFlags: CliFlags = {
  ...queryFlags,
  cancelAfterMs: {
    value: "<ms>",
    description:
      "Request a cancel from a timer this many milliseconds after the run starts",
  },
  heap: {
    value: "<true>",
    description: "Sample the JavaScript heap at every pause of the run",
  },
};

interface SliceRecord {
  ms: number;
  index: number;
  statements: { reader: ItemQueryReader; rows: number }[];
}

export interface QueryMeasureReport {
  outcome: "answered" | "cancelled" | "failed";
  error?: string;
  ok?: boolean;
  diagnosticCode?: string;
  returnedCount?: number;
  truncated?: boolean;
  totalMs: number;
  adapterMs?: number;
  engineMs?: number;
  answerMs?: number;
  channels?: { created: number; closed: number; open: number };
  answerBytes?: number;
  answerSteps: number[];
  slices: number[];
  uiGaps: number[];
  worstSlice?: SliceRecord;
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
  cancel?: {
    intendedAtMs?: number;
    firedAtMs: number;
    settledAtMs: number;
    firedAtEpochMs: number;
    events: CancellationEvent[];
  };
  window: {
    visibleAtStart: boolean;
    visibleAtEnd: boolean;
    hiddenDuringRun: boolean;
    focused: boolean;
  };
  startedAtEpochMs: number;
}

const errorText = (error: unknown): string =>
  Error.isError(error) ? error.message : String(error);
const round = (ms: number): number => Math.round(ms * 100) / 100;

const measureParams = cliParams({
  cancelAfterMs: Schema.optionalKey(
    Schema.String.check(
      Schema.makeFilter(
        (text: string) =>
          (text.trim() !== "" &&
            Number.isFinite(Number(text)) &&
            Number(text) >= 0) ||
          `cancelAfterMs '${text}' is not a time in milliseconds: use a number from 0.`,
      ),
    ).pipe(cliMap(Number)),
  ),
  heap: cliSwitch("heap is a switch: name it alone, as heap."),
});

export const layerQueryMeasureCli: Layer.Layer<
  never,
  never,
  PluginHost | QueryService
> = Layer.effectDiscard(
  Effect.gen(function* () {
    registerQueryMeasureCli(yield* PluginHost, yield* QueryService);
  }),
);

export function registerQueryMeasureCli(
  host: CliHost,
  queryService: Pick<QueryService["Service"], "measure">,
): void {
  const measure = Effect.fn("QueryCli.measure")(function* (params: CliData) {
    const runParams: CliData = {};
    const query: CliData = {};
    for (const [key, value] of Object.entries(params)) {
      const name = key.replace(/^--/, "");
      (Object.hasOwn(measureParams.fields, name) ? runParams : query)[key] =
        value;
    }
    const rejected = (rejection: CliRejection) =>
      new TypeError(rejectionText(rejection));
    const measured = yield* decodeCliParams(runParams, measureParams, {
      command: QUERY_MEASURE_COMMAND,
    }).pipe(Effect.mapError((rejection) => rejected(rejection)));
    yield* decodeQuery(query).pipe(
      Effect.mapError((rejection) => rejected(rejection)),
    );
    return yield* measureRun({ queryService, query, measured });
  });

  host.registerCliCommand(QUERY_MEASURE_COMMAND, {
    description:
      "Run one ZotLit Query and report its slices, statements, heap, and cancel times (dev build)",
    flags: queryMeasureFlags,
    handler: measure,
  });
}

const measureRun = Effect.fn("QueryCli.measureRun")(function* ({
  queryService,
  query,
  measured,
}: {
  queryService: Pick<QueryService["Service"], "measure">;
  query: CliData;
  measured: CliOutput<typeof measureParams>;
}) {
  const now = monotonicMillis(yield* Clock.Clock);
  let measurement: WorkerMeasurement | undefined;
  const cancellationEvents: CancellationEvent[] = [];
  const uiGaps: number[] = [];
  let lastTick = now();
  const sampleUi = () => {
    const at = now();
    uiGaps.push(round(at - lastTick));
    lastTick = at;
  };
  let hiddenDuringRun = document.visibilityState !== "visible";
  const visibleAtStart = !hiddenDuringRun;
  const onVisibility = () => {
    if (document.visibilityState !== "visible") hiddenDuringRun = true;
  };

  const startedAt = now();
  const startedAtEpochMs = yield* Clock.currentTimeMillis;
  let firedAt: number | undefined;

  const settled = yield* Effect.gen(function* () {
    yield* Effect.acquireRelease(
      Effect.sync(() => window.setInterval(sampleUi, 4)),
      (uiTimer) =>
        Effect.sync(() => {
          sampleUi();
          window.clearInterval(uiTimer);
        }),
    );
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        document.addEventListener("visibilitychange", onVisibility),
      ),
      () =>
        Effect.sync(() =>
          document.removeEventListener("visibilitychange", onVisibility),
        ),
    );
    const run = yield* Effect.forkScoped(
      queryService.measure(query, {
        completed: (report) => {
          measurement = report;
        },
        cancelled: (event) => {
          if (event.phase === "requested") firedAt ??= now();
          cancellationEvents.push(event);
        },
        heap: measured.heap === true,
      }),
    );
    if (measured.cancelAfterMs !== undefined)
      yield* Effect.forkScoped(
        Effect.sleep(measured.cancelAfterMs).pipe(
          Effect.andThen(Fiber.interrupt(run)),
        ),
      );
    return yield* Fiber.await(run);
  }).pipe(Effect.scoped);
  const settledAt = now();

  const answer = Exit.isSuccess(settled) ? settled.value : undefined;
  const outcome: QueryMeasureReport["outcome"] = Exit.isSuccess(settled)
    ? "answered"
    : firedAt === undefined
      ? "failed"
      : "cancelled";
  const error = Exit.isFailure(settled)
    ? errorText(Cause.squash(settled.cause))
    : undefined;

  const envelope =
    answer === undefined
      ? undefined
      : (JSON.parse(answer) as {
          ok: boolean;
          returnedCount?: number;
          truncated?: boolean;
          diagnostic?: { code: string };
        });

  const report: QueryMeasureReport = {
    outcome,
    error,
    ok: envelope?.ok,
    diagnosticCode: envelope?.diagnostic?.code,
    returnedCount: envelope?.returnedCount,
    truncated: envelope?.truncated,
    totalMs: round(settledAt - startedAt),
    adapterMs:
      measurement === undefined
        ? undefined
        : round(settledAt - startedAt - measurement.workerMs),
    engineMs: measurement?.engineMs,
    answerMs: measurement?.answerMs,
    answerBytes: answer?.length,
    answerSteps: measurement?.answerSteps ?? [],
    uiGaps,
    slices: measurement?.slices ?? [],
    worstSlice: measurement?.worstSlice,
    pauses: measurement?.pauses ?? 0,
    longestPauseMs: measurement?.longestPauseMs ?? 0,
    statements: measurement?.statements ?? {},
    heap: measurement?.heap,
    channels: measurement?.channels,
    cancel:
      firedAt === undefined
        ? undefined
        : {
            intendedAtMs: measured.cancelAfterMs,
            firedAtMs: round(firedAt - startedAt),
            settledAtMs: round(settledAt - startedAt),
            firedAtEpochMs: round(startedAtEpochMs + firedAt - startedAt),
            events: cancellationEvents,
          },
    window: {
      visibleAtStart,
      visibleAtEnd: document.visibilityState === "visible",
      hiddenDuringRun,
      focused: document.hasFocus(),
    },
    startedAtEpochMs,
  };
  return JSON.stringify(report);
});
