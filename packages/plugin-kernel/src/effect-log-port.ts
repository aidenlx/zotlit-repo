import {
  Cause,
  Clock,
  Effect,
  Layer,
  Logger,
  LogLevel,
  MutableRef,
  Option,
  Queue,
  Ref,
  References,
  Schema,
  Stream,
} from "effect";

import { setLibraryLogSink } from "@zotlit/shared/logging";
import type { LibraryLogLevel, LibraryLogRecord } from "@zotlit/shared/logging";

import {
  LogCategory,
  LogTimestamp,
  withLogCategory,
} from "#effect-log-category.ts";

export type PortLogLevel =
  | "trace"
  | "debug"
  | "info"
  | "warning"
  | "error"
  | "fatal";

export const LogPortRecordSchema = Schema.Struct({
  level: Schema.Literals(["Fatal", "Error", "Warn", "Info", "Debug", "Trace"]),
  category: Schema.Array(Schema.String),
  message: Schema.String,
  details: Schema.Array(Schema.Unknown),
  annotations: Schema.Record(Schema.String, Schema.Unknown),
  error: Schema.NullOr(
    Schema.Struct({
      name: Schema.String,
      message: Schema.String,
      stack: Schema.NullOr(Schema.String),
    }),
  ),
  timestamp: Schema.Finite,
});

export type LogPortRecord = typeof LogPortRecordSchema.Type;

export interface LogMessagePort {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage(message: unknown): void;
  close(): void;
}

const LEVELS: Readonly<Record<PortLogLevel, LogLevel.LogLevel>> = {
  trace: "Trace",
  debug: "Debug",
  info: "Info",
  warning: "Warn",
  error: "Error",
  fatal: "Fatal",
};

const LIBRARY_LEVELS: Readonly<
  Record<LibraryLogLevel, LogPortRecord["level"]>
> = {
  trace: "Trace",
  debug: "Debug",
  info: "Info",
  warn: "Warn",
  error: "Error",
  fatal: "Fatal",
};

const rejectedText = (value: unknown): string => {
  switch (typeof value) {
    case "string":
      return value;
    case "number":
    case "bigint":
    case "boolean":
      return String(value);
    case "undefined":
      return "undefined";
    case "symbol":
      return Symbol.prototype.toString.call(value);
    case "function":
      return Function.prototype.toString.call(value);
    case "object":
      return value === null ? "null" : Object.prototype.toString.call(value);
  }
};

const cloneSafe = (
  value: unknown,
  seen: WeakSet<object> = new WeakSet(),
): unknown => {
  try {
    structuredClone(value);
    return value;
  } catch {
    if (Array.isArray(value)) {
      if (seen.has(value)) return "[Circular]";
      seen.add(value);
      return value.map((item) => cloneSafe(item, seen));
    }
    if (value !== null && typeof value === "object") {
      if (value instanceof Map || value instanceof Set)
        return rejectedText(value);
      if (seen.has(value)) return "[Circular]";
      seen.add(value);
      const entries = Object.entries(value).map(([key, item]) => [
        key,
        cloneSafe(item, seen),
      ]);
      return Object.fromEntries(entries);
    }
    return rejectedText(value);
  }
};

const errorFromCause = (cause: Cause.Cause<unknown>) => {
  if (cause.reasons.length === 0) return null;
  const error = Cause.squash(cause);
  const fields: {
    readonly name?: unknown;
    readonly message?: unknown;
    readonly stack?: unknown;
  } = error !== null && typeof error === "object" ? error : {};
  return {
    name:
      typeof fields.name === "string" && fields.name.length > 0
        ? fields.name
        : "Error",
    message:
      typeof fields.message === "string" ? fields.message : rejectedText(error),
    stack: typeof fields.stack === "string" ? fields.stack : null,
  };
};

export const makeLogPortRecord = (
  options: Logger.Options<unknown>,
): LogPortRecord => {
  const parts = Array.isArray(options.message)
    ? options.message
    : [options.message];
  return {
    level: options.logLevel as LogPortRecord["level"],
    category: [...options.fiber.getRef(LogCategory)],
    message: rejectedText(parts[0] ?? ""),
    details: parts.slice(1).map((part) => cloneSafe(part)),
    annotations: Object.fromEntries(
      Object.entries(
        options.fiber.getRef(References.CurrentLogAnnotations),
      ).map(([key, value]) => [key, cloneSafe(value)]),
    ),
    error: errorFromCause(options.cause),
    timestamp: options.date.getTime(),
  };
};

export const makePortLogger = (
  port: Pick<LogMessagePort, "postMessage">,
  level: Ref.Ref<PortLogLevel | null>,
): Logger.Logger<unknown, void> => {
  const failedKinds = MutableRef.make<ReadonlySet<string>>(new Set());
  return Logger.make((options) => {
    const selected = Ref.getUnsafe(level);
    if (
      selected === null ||
      options.logLevel === "All" ||
      options.logLevel === "None" ||
      !LogLevel.isGreaterThanOrEqualTo(options.logLevel, LEVELS[selected])
    )
      return;

    const record = makeLogPortRecord(options);
    try {
      port.postMessage(record);
    } catch (error) {
      const kind =
        error instanceof Error
          ? `${error.name}: ${error.message}`
          : rejectedText(error);
      if (failedKinds.current.has(kind)) return;
      failedKinds.current = new Set(failedKinds.current).add(kind);
      // oxlint-disable-next-line effecttsgo/global-console -- the port cannot log its own post failure through Effect without recursing.
      console.error("ZotLit worker log port failed:", kind, error);
    }
  });
};

export const layerLibraryLogPort: Layer.Layer<never> = Layer.effectDiscard(
  Effect.gen(function* () {
    const records = yield* Queue.unbounded<LibraryLogRecord, Cause.Done>();
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        setLibraryLogSink((record) => Queue.offerUnsafe(records, record));
      }),
      () => Effect.sync(() => setLibraryLogSink(undefined)),
    );
    yield* Stream.fromQueue(records).pipe(
      Stream.runForEach((record) =>
        Effect.gen(function* () {
          yield* emitLogPortRecord({
            level: LIBRARY_LEVELS[record.level],
            category: record.category,
            message: record.message,
            details: [],
            annotations: record.properties,
            error: null,
            timestamp: yield* Clock.currentTimeMillis,
          });
        }),
      ),
      Effect.forkScoped,
    );
  }),
);

const emitLogPortRecord = (record: LogPortRecord) => {
  const annotations = {
    ...record.annotations,
    ...(record.error !== null && { error: record.error }),
  };
  return Effect.logWithLevel(record.level)(
    record.message,
    ...record.details,
  ).pipe(
    Effect.provideService(LogTimestamp, record.timestamp),
    Effect.annotateLogs(annotations),
    withLogCategory(...(record.category as [string, ...string[]])),
  );
};

export const layerHostLogPort = (
  port: LogMessagePort,
  {
    malformedMessage,
    category,
  }: {
    readonly malformedMessage: string;
    readonly category: readonly [string, ...string[]];
  },
): Layer.Layer<never> =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const records = yield* Queue.unbounded<LogPortRecord, Cause.Done>();
      const receive = ({ data }: MessageEvent) => {
        Queue.offerUnsafe(records, data);
      };
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          port.onmessage = receive;
        }),
        () =>
          Effect.sync(() => {
            port.onmessage = null;
            port.close();
          }).pipe(Effect.ensuring(Queue.end(records))),
      );
      yield* Stream.fromQueue(records).pipe(
        Stream.runForEach((data) => {
          const record = Schema.decodeOption(LogPortRecordSchema)(data);
          return Option.match(record, {
            onNone: () =>
              Effect.logWarning(malformedMessage).pipe(
                withLogCategory(...category),
              ),
            onSome: emitLogPortRecord,
          });
        }),
        Effect.forkScoped,
      );
    }),
  );
