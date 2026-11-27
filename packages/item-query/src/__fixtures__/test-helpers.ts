import {
  Cause,
  Clock,
  Context,
  Effect,
  Exit,
  Logger,
  References,
} from "effect";
import type { Scheduler } from "effect";
import { expect } from "vitest";

import type { ZoteroDatabase } from "@zotlit/db";
import { SCENARIO_LIBRARIES } from "@zotlit/db-testing/scenario";
import {
  ItemQueryDatabase,
  ItemQueryStatementObserver,
} from "@zotlit/db/item-query";
import type { StatementRun } from "@zotlit/db/item-query";
import { LogCategory } from "@zotlit/shared/logging";

import type { QueryDataset } from "#dataset.ts";
import { QueryTimeZone } from "#query-clock.ts";
import { collectQuery } from "#query.ts";
import type { ItemQueryRequest } from "#request.ts";
import { ItemQueryScheduler, ItemQuerySliceObserver } from "#scheduler.ts";
import { ItemQueryTuning, PRODUCTION_TUNING } from "#tuning.ts";
import type { Tuning } from "#tuning.ts";

export interface CapturedLog {
  readonly level: string;
  readonly message: unknown;
  readonly category: readonly string[];
  readonly properties: Readonly<Record<string, unknown>>;
}

const captureLog = (logs: CapturedLog[]): Logger.Logger<unknown, void> =>
  Logger.make(({ logLevel, message, fiber }) => {
    logs.push({
      level: logLevel,
      message: Array.isArray(message) ? message[0] : message,
      category: fiber.getRef(LogCategory),
      properties: fiber.getRef(References.CurrentLogAnnotations),
    });
  });

export interface RunOptions {
  client?: ZoteroDatabase;
  now?: string;
  timeZone?: string;
  signal?: AbortSignal;
  tuning?: Partial<Tuning>;
  scheduler?: Scheduler.Scheduler;
  onEvent?: (event: RunEvent) => void;
  onResume?: () => void;
  logs?: CapturedLog[];
  keepStatements?: boolean;
}

export type RunEvent =
  | { readonly type: "statement"; readonly statement: StatementRun }
  | { readonly type: "pause" };

export interface Run<A, E> {
  exit: Exit.Exit<A, E>;
  pauses: number;
  events: RunEvent[];
}

export const TEST_NOW = "2024-07-15T12:00:00Z";

export async function runEffect<A, E>(
  effect: Effect.Effect<A, E, ItemQueryDatabase>,
  options: RunOptions = {},
): Promise<Run<A, E>> {
  const events: RunEvent[] = [];
  const record = (event: RunEvent) => {
    if (event.type === "pause" || options.keepStatements !== false) {
      events.push(event);
    }
    options.onEvent?.(event);
  };
  const services = Context.make(
    Clock.Clock,
    fixedClock(options.now ?? TEST_NOW),
  ).pipe(
    Context.add(QueryTimeZone, options.timeZone ?? "UTC"),
    Context.add(ItemQueryTuning, { ...PRODUCTION_TUNING, ...options.tuning }),
    Context.add(ItemQueryDatabase, {
      get client(): ZoteroDatabase {
        if (options.client) return options.client;
        throw new Error("the test passed no database client to runEffect.");
      },
    }),
    Context.add(ItemQueryStatementObserver, (statement) =>
      record({ type: "statement", statement }),
    ),
    Context.add(ItemQuerySliceObserver, {
      paused: () => record({ type: "pause" }),
      resumed: () => options.onResume?.(),
    }),
  );
  const provided = Effect.provideContext(effect, services);
  const runnable = options.logs
    ? Effect.provideService(
        Effect.provide(provided, Logger.layer([captureLog(options.logs)])),
        References.MinimumLogLevel,
        "All",
      )
    : provided;
  const exit = await Effect.runPromiseExit(runnable, {
    scheduler: options.scheduler ?? testScheduler(),
    signal: options.signal,
  });
  const pauses = events.filter((event) => event.type === "pause").length;
  if (options.scheduler === undefined && pauses > MAX_TEST_PAUSES) {
    throw new Error(
      `The run paused ${pauses} times, above ${MAX_TEST_PAUSES}. Each pause of the test scheduler is one host task, so a slow machine runs this test past its timeout. Pass scheduler: new ItemQueryScheduler() unless the test checks pauses.`,
    );
  }
  return { exit, pauses, events };
}

const MAX_TEST_PAUSES = 20_000;

function testScheduler(): ItemQueryScheduler {
  let ticks = 0;
  return new ItemQueryScheduler({ budgetMs: 1, now: () => ticks++ });
}

function fixedClock(now: string): Clock.Clock {
  const millis = Temporal.Instant.from(now).epochMilliseconds;
  const nanos = BigInt(millis) * 1_000_000n;
  return {
    currentTimeMillisUnsafe: () => millis,
    currentTimeMillis: Effect.succeed(millis),
    currentTimeNanosUnsafe: () => nanos,
    currentTimeNanos: Effect.succeed(nanos),
    monotonicTimeNanosUnsafe: () => nanos,
    monotonicTimeNanos: Effect.succeed(nanos),
    sleep: () => Effect.void,
  };
}

export async function faultCode(
  dataset: QueryDataset,
  client: ZoteroDatabase,
  request: Omit<ItemQueryRequest, "libraries">,
): Promise<string | null> {
  const { exit } = await runEffect(
    collectQuery(dataset, {
      libraries: [SCENARIO_LIBRARIES.personal],
      limit: 1,
      ...request,
    }),
    { client, scheduler: new ItemQueryScheduler() },
  );
  if (Exit.isSuccess(exit)) {
    expect(exit.value.warnings).toEqual([]);
    return null;
  }
  const error = Cause.findErrorOption(exit.cause);
  if (error._tag === "None") throw new Error(String(exit.cause));
  return (error.value as { code?: string }).code ?? error.value._tag;
}
