import { Effect, Logger, Queue } from "effect";

import type { LogLevel, LogRecord } from "@zotlit/shared/log-formatter";

import { currentLogOutputs, setLogOutputs } from "#effect-log.ts";

export interface CapturedLogs extends Disposable {
  readonly records: LogRecord[];
  readonly release: () => void;
}

export function forwardLogRecords(
  forward: (record: LogRecord) => void,
  level: LogLevel = "trace",
): Disposable {
  const previous = currentLogOutputs();
  setLogOutputs({
    level,
    sinks: [Logger.make<LogRecord, void>(({ message }) => forward(message))],
  });
  return { [Symbol.dispose]: () => setLogOutputs(previous) };
}

export function captureLogRecords(level: LogLevel = "trace"): CapturedLogs {
  const records: LogRecord[] = [];
  const forwarding = forwardLogRecords((record) => records.push(record), level);
  const release = () => forwarding[Symbol.dispose]();
  return { records, release, [Symbol.dispose]: release };
}

export const capturedLogQueue = Effect.acquireRelease(
  Effect.gen(function* () {
    const queue = yield* Queue.unbounded<LogRecord>();
    const previous = currentLogOutputs();
    setLogOutputs({
      level: "trace",
      sinks: [
        Logger.make<LogRecord, void>(({ message }) => {
          Queue.offerUnsafe(queue, message);
        }),
      ],
    });
    return { queue, previous };
  }),
  ({ previous }) => Effect.sync(() => setLogOutputs(previous)),
).pipe(Effect.map(({ queue }) => queue));
