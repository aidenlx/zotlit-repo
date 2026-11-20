// The plugin logger's sinks and level, following the log settings.

import type { Settings } from "#obsidian/settings/service.ts";
import { Context, Effect, Exit, Layer, Scope, Stream } from "effect";
import type { Logger } from "effect";
import type { Plugin } from "obsidian";

import {
  releaseLogOutputs,
  setLogOutputs,
  withLogCategory,
} from "@zotlit/plugin-kernel/effect-log.ts";
import type {
  LogLevel,
  LogOutputs,
  LogRecord,
} from "@zotlit/plugin-kernel/effect-log.ts";
import { consoleLogSink } from "@zotlit/plugin-kernel/log-console.ts";

import { openVaultFileSink } from "./vault-sink.ts";

import { PluginSettings } from "#obsidian/settings/service.ts";

export const LOG_FILENAME = "zotlit.log.jsonl";

type LogConfig = LogOutputs;

/**
 * What {@link layerLogging} drives: the sinks and levels of the plugin's own
 * loggers, and the log file.
 */
export class LogOutput extends Context.Service<
  LogOutput,
  {
    configureSync(config: LogConfig): Effect.Effect<void, unknown>;
    configure(config: LogConfig): Effect.Effect<void, unknown>;
    readonly reset: Effect.Effect<void, unknown>;
    /** The plugin's log file, truncated; closing the scope drains it. */
    readonly openFile: Effect.Effect<
      Logger.Logger<LogRecord, void>,
      unknown,
      Scope.Scope
    >;
  }
>()("zotlit/log/LogOutput") {}

/** The plugin logger's outputs, and the log file in the plugin's folder. */
export function layerLogOutput(
  plugin: Pick<Plugin, "app" | "manifest">,
): Layer.Layer<LogOutput> {
  const path = `${plugin.manifest.dir}/${LOG_FILENAME}`;
  const { adapter } = plugin.app.vault;
  return Layer.succeed(
    LogOutput,
    LogOutput.of({
      configureSync: Effect.fn("LogOutput.configureSync")((config) =>
        Effect.sync(() => setLogOutputs(config)),
      ),
      configure: Effect.fn("LogOutput.configure")((config) =>
        Effect.sync(() => setLogOutputs(config)),
      ),
      reset: Effect.sync(releaseLogOutputs),
      openFile: openVaultFileSink(adapter, path),
    }),
  );
}

interface LogSettings {
  readonly level: LogLevel | null;
  readonly toFile: boolean;
}

/** Until the log settings load, records go to the console. */
export const STARTUP_LOG_SETTINGS: LogSettings = {
  level: __DEV__ ? "debug" : "info",
  toFile: false,
};

/**
 * Configures the plugin logger when it builds, so every service built after it logs
 * from its first line, then applies each change to the log settings. While a
 * change applies, later changes wait and only the newest is applied; a change
 * that fails is applied again on the next settings change. A `null`
 * `log.level` writes no record and opens no file.
 *
 * Closing the layer waits for an applying change, drains the log file, and
 * removes the plugin logger's sinks. A failure is logged as an error, which
 * reaches the console under any configuration.
 */
export const layerLogging: Layer.Layer<
  never,
  never,
  PluginSettings | LogOutput
> = Layer.effectDiscard(
  Effect.gen(function* () {
    const settings = yield* PluginSettings;
    const output = yield* LogOutput;

    yield* Effect.addFinalizer(() =>
      output.reset.pipe(reportFailure("Could not reset logging")),
    );
    yield* output
      .configureSync(logConfig(STARTUP_LOG_SETTINGS))
      .pipe(reportFailure("Could not configure startup logging"));

    // The open log file's scope, closed before the next file opens: a new
    // file truncates the same path.
    let fileScope = yield* Scope.make();
    yield* Effect.addFinalizer(() => Scope.close(fileScope, Exit.void));

    let applied: LogSettings | undefined;
    const apply = (next: LogSettings) =>
      Effect.gen(function* () {
        if (applied && sameLogSettings(applied, next)) return;
        yield* Scope.close(fileScope, Exit.void);
        fileScope = yield* Scope.make();
        const file =
          next.level !== null && next.toFile
            ? yield* output.openFile.pipe(Scope.provide(fileScope))
            : undefined;
        yield* output.configure(logConfig(next, file));
        applied = next;
      }).pipe(
        Effect.uninterruptible,
        reportFailure("Could not apply the log settings"),
      );

    yield* logSettingsChanges(settings).pipe(
      Stream.runForEach((next) => apply(next)),
      Effect.forkScoped,
    );
  }),
);

/** Report a failure of `effect` to the console and carry on. */
const reportFailure =
  (message: string) =>
  <E, R>(effect: Effect.Effect<void, E, R>): Effect.Effect<void, never, R> =>
    Effect.catchCause(effect, (cause) =>
      Effect.logError(message, cause).pipe(withLogCategory("log")),
    );

/**
 * The log settings once loaded, then on each settings change; a slow reader
 * sees only the newest.
 */
function logSettingsChanges(
  settings: PluginSettings["Service"],
): Stream.Stream<LogSettings> {
  return settings.changes.pipe(
    Stream.filter((value): value is Readonly<Settings> => value !== null),
    Stream.map((value) => logSettingsOf(value)),
    Stream.buffer({ capacity: 1, strategy: "sliding" }),
  );
}

function logSettingsOf(value: Readonly<Settings>): LogSettings {
  return { level: value["log.level"], toFile: value["log.to-file"] };
}

function sameLogSettings(a: LogSettings, b: LogSettings): boolean {
  return a.level === b.level && a.toFile === b.toFile;
}

function logConfig(
  settings: LogSettings,
  file?: Logger.Logger<LogRecord, void>,
): LogConfig {
  if (settings.level === null) return { level: null, sinks: [] };
  return {
    level: settings.level,
    sinks: file ? [consoleLogSink, file] : [consoleLogSink],
  };
}
