import { getConsoleSink, getLogger as tapGetLogger } from "@logtape/logtape";
import type { LogLevel, LogRecord, Logger, Sink } from "@logtape/logtape";

let categoryRoot = "zotlit";

export function setLogCategoryRoot(id: string): void {
  categoryRoot = id;
}

export function logCategoryRoot(): string {
  return categoryRoot;
}

export function pluginLogCategory(
  category: readonly string[],
): [string, ...string[]] {
  return category[0] === "zotlit"
    ? [categoryRoot, ...category.slice(1)]
    : [categoryRoot, "obsidian", ...category];
}

export interface PluginLogConfig {
  readonly sinks: Readonly<Record<string, Sink>>;
  readonly loggers: readonly {
    readonly category: string | readonly string[];
    readonly sinks?: readonly string[];
    readonly lowestLevel?: LogLevel | null;
  }[];
}

export interface PluginLogTape {
  configure(config: PluginLogConfig): void;
  release(): void;
}

interface LoggerState {
  readonly sinks: Sink[];
  lowestLevel: LogLevel | null;
  readonly children: Record<string, LoggerState | WeakRef<LoggerState>>;
}

const OWNER = Symbol.for("zotlit.log.owner");

type OwnedSink = Sink & { readonly [OWNER]: string };

const LOGTAPE_ROOT = Symbol.for("logtape.rootLogger");

const stateOf = (logger: Logger) => logger as unknown as LoggerState;

const removeSinks = (logger: LoggerState, drop: (sink: Sink) => boolean) => {
  for (let i = logger.sinks.length - 1; i >= 0; i--)
    if (drop(logger.sinks[i]!)) logger.sinks.splice(i, 1);
};

const holdsSinks = (logger: LoggerState): boolean =>
  logger.sinks.length > 0 ||
  Object.values(logger.children).some((child) => {
    const state = "deref" in child ? child.deref() : child;
    return state !== undefined && holdsSinks(state);
  });

export function pluginLogTape(): PluginLogTape {
  let configured: LoggerState[] = [];
  let added = new Set<Sink>();
  return {
    configure(config) {
      const owner = categoryRoot;
      const owned = new Map(
        Object.entries(config.sinks).map(([id, target]) => [
          id,
          Object.assign((record: LogRecord) => target(record), {
            [OWNER]: owner,
          }) satisfies OwnedSink,
        ]),
      );
      const loggers: LoggerState[] = [];
      for (const entry of config.loggers) {
        const logger = stateOf(tapGetLogger(entry.category));
        removeSinks(logger, (sink) => (sink as OwnedSink)[OWNER] === owner);
        for (const id of entry.sinks ?? []) logger.sinks.push(owned.get(id)!);
        if (entry.lowestLevel !== undefined)
          logger.lowestLevel = entry.lowestLevel;
        loggers.push(logger);
      }
      configured = loggers;
      added = new Set(owned.values());
    },
    release() {
      for (const logger of configured) {
        removeSinks(logger, (sink) => added.has(sink));
        if (logger.sinks.length === 0) logger.lowestLevel = "trace";
      }
      configured = [];
      added = new Set();
      if (!holdsSinks(stateOf(tapGetLogger())))
        // oxlint-disable-next-line obsidianmd/no-global-this -- LogTape keeps its root on the realm global
        delete (globalThis as Record<symbol, unknown>)[LOGTAPE_ROOT];
    },
  };
}

const startupLogTape = pluginLogTape();

/**
 * Wires a console sink before the services build, so dev builds keep startup
 * records (locale resolution, Language Pack install) that would otherwise be
 * dropped. `layerLogging` replaces these sinks with its own.
 */
export function enableStartupLogging(): void {
  startupLogTape.configure({
    sinks: { console: getConsoleSink() },
    loggers: [
      { category: [categoryRoot], sinks: ["console"], lowestLevel: "debug" },
      {
        category: ["logtape", "meta"],
        sinks: ["console"],
        lowestLevel: "warning",
      },
    ],
  });
}

/**
 * Derive a logger under the plugin's obsidian root.
 * @param subcategory single string or non-empty array appended to the
 *   plugin's `[id, "obsidian"]`.
 */
export function getLogger(
  subcategory: string | readonly [string] | readonly [string, ...string[]],
): Logger {
  const category =
    typeof subcategory === "string" ? [subcategory] : subcategory;
  return tapGetLogger([categoryRoot, "obsidian", ...category]);
}
