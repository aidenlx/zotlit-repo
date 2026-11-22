import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Logger from "effect/Logger";
import * as References from "effect/References";

import { LOG_LEVELS } from "@zotlit/shared/log-formatter";
import type { LogLevel, LogRecord } from "@zotlit/shared/log-formatter";
import { setLibraryLogSink } from "@zotlit/shared/logging";

import type { EffectBridge } from "./effect-bridge.ts";
import {
  LogCategory,
  LogTimestamp,
  withLogCategory,
} from "./effect-log-category.ts";
import { consoleLogSink } from "./log-console.ts";
import { PLUGIN_ID } from "./plugin-id.ts";

export { LogCategory, withLogCategory };
export type { LogLevel, LogRecord };

const LEVELS = {
  Trace: "trace",
  Debug: "debug",
  Info: "info",
  Warn: "warning",
  Error: "error",
  Fatal: "fatal",
} as const;

const LIBRARY_LEVELS = {
  trace: "Trace",
  debug: "Debug",
  info: "Info",
  warn: "Warn",
  error: "Error",
  fatal: "Fatal",
} as const;

export function pluginLogCategory(
  category: readonly string[],
): [string, ...string[]] {
  return category[0] === "zotlit"
    ? [PLUGIN_ID, ...category.slice(1)]
    : [PLUGIN_ID, "obsidian", ...category];
}

const unescapeBraces = (text: string) =>
  text.replaceAll("{{", "{").replaceAll("}}", "}");

const propertyAt = (
  properties: Readonly<Record<string, unknown>>,
  key: string,
): unknown => {
  const trimmed = key.trim();
  const value = key in properties ? properties[key] : properties[trimmed];
  if (value !== undefined || !trimmed.includes(".")) return value;
  let nested: unknown = properties;
  for (const part of trimmed.split(".")) {
    if (nested === null || typeof nested !== "object") return undefined;
    nested = (nested as Record<string, unknown>)[part];
  }
  return nested;
};

const renderTemplate = (
  template: string,
  properties: Readonly<Record<string, unknown>>,
): unknown[] => {
  if (!template.includes("{")) return [template];
  const message: unknown[] = [];
  let start = 0;
  for (let i = 0; i < template.length; i++) {
    const char = template[i];
    if (char === "{") {
      if (template[i + 1] === "{") {
        i++;
        continue;
      }
      const close = template.indexOf("}", i + 1);
      if (close === -1) continue;
      message.push(unescapeBraces(template.slice(start, i)));
      message.push(propertyAt(properties, template.slice(i + 1, close)));
      i = close;
      start = i + 1;
    } else if (char === "}" && template[i + 1] === "}") i++;
  }
  message.push(unescapeBraces(template.slice(start)));
  return message;
};

const logRecordOf = (
  { message, cause, fiber, date }: Logger.Options<unknown>,
  level: LogLevel,
): LogRecord => {
  const [text, ...details] = Array.isArray(message) ? message : [message];
  const properties: Record<string, unknown> = {
    ...fiber.getRef(References.CurrentLogAnnotations),
  };
  const spans = fiber.getRef(References.CurrentLogSpans);
  if (spans.length > 0)
    properties["spans"] = Object.fromEntries(
      spans.map(([label, start]) => [label, date.getTime() - start]),
    );
  if (details.length > 0) properties["details"] = details;
  if (cause.reasons.length > 0) properties["error"] = Cause.squash(cause);
  const base = {
    category: pluginLogCategory(fiber.getRef(LogCategory)),
    level,
    timestamp: fiber.getRef(LogTimestamp) ?? date.getTime(),
  };
  if (typeof text === "string")
    return {
      ...base,
      rawMessage: text,
      message: renderTemplate(text, properties),
      properties,
    };
  return {
    ...base,
    rawMessage: "{message}",
    message: ["", text, ""],
    properties: { message: text, ...properties },
  };
};

export interface LogOutputs {
  readonly level: LogLevel | null;
  readonly sinks: readonly Logger.Logger<LogRecord, unknown>[];
}

const RELEASED: LogOutputs = { level: "error", sinks: [consoleLogSink] };

let outputs: LogOutputs = RELEASED;

export const currentLogOutputs = (): LogOutputs => outputs;

export const setLogOutputs = (next: LogOutputs): void => {
  outputs = next;
};

export const releaseLogOutputs = (): void => {
  outputs = RELEASED;
};

export function enableStartupLogging(): void {
  outputs = { level: "debug", sinks: [consoleLogSink] };
}

const isAtLeast = (level: LogLevel, lowest: LogLevel) =>
  LOG_LEVELS.indexOf(level) >= LOG_LEVELS.indexOf(lowest);

export const logLevelEnabled = (level: LogLevel): boolean =>
  outputs.level !== null && isAtLeast(level, outputs.level);

const writeTo = (
  sinks: readonly Logger.Logger<LogRecord, unknown>[],
  options: Logger.Options<unknown>,
  record: LogRecord,
) => {
  for (const sink of sinks) {
    try {
      sink.log({ ...options, message: record });
    } catch (error) {
      writeTo(
        sinks.filter((other) => other !== sink),
        options,
        {
          category: [PLUGIN_ID, "log"],
          level: "fatal",
          timestamp: record.timestamp,
          rawMessage: "Failed to write a log record to a sink: {error}",
          message: ["Failed to write a log record to a sink: ", error, ""],
          properties: { error, record },
        },
      );
    }
  }
};

export const pluginLogger = Logger.make<unknown, void>((options) => {
  const { level: lowest, sinks } = outputs;
  if (
    lowest === null ||
    options.logLevel === "All" ||
    options.logLevel === "None"
  )
    return;
  const level = LEVELS[options.logLevel];
  if (!isAtLeast(level, lowest)) return;
  writeTo(sinks, options, logRecordOf(options, level));
});

export const logServices = Context.make(
  Logger.CurrentLoggers,
  new Set([pluginLogger]),
).pipe(Context.add(References.MinimumLogLevel, "All"));

setLibraryLogSink(({ level, category, message, properties }) =>
  Effect.runSyncWith(logServices)(
    Effect.logWithLevel(LIBRARY_LEVELS[level])(message).pipe(
      Effect.annotateLogs(properties),
      withLogCategory(...category),
    ),
  ),
);

export const logAndContinue =
  (
    message: string,
    category: string,
    annotations?: Readonly<Record<string, unknown>>,
  ) =>
  <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A | void, never, R> =>
    effect.pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) return Effect.interrupt;
        const logged = Effect.logError(message, cause);
        return (
          annotations ? Effect.annotateLogs(logged, annotations) : logged
        ).pipe(withLogCategory(category));
      }),
    );

type BridgeLogMethod = (
  message: string,
  fields?: Readonly<Record<string, unknown>>,
) => void;

export function bridgeLog(
  bridge: Pick<EffectBridge, "runSync">,
  category: string,
): Record<"trace" | "debug" | "info" | "warn" | "error", BridgeLogMethod> {
  const at =
    (log: (message: string) => Effect.Effect<void>): BridgeLogMethod =>
    (message, fields) => {
      const record = log(message);
      bridge.runSync(
        (fields ? Effect.annotateLogs(record, fields) : record).pipe(
          withLogCategory(category),
        ),
      );
    };
  return {
    trace: at(Effect.logTrace),
    debug: at(Effect.logDebug),
    info: at(Effect.logInfo),
    warn: at(Effect.logWarning),
    error: at(Effect.logError),
  };
}
