import { it } from "@effect/vitest";
import {
  Effect,
  Exit,
  Fiber,
  Layer,
  Logger,
  Queue,
  Schema,
  Scope,
} from "effect";
import { TestClock } from "effect/testing";
import type { App, Plugin } from "obsidian";
import { expect } from "vitest";

import { captureLogRecords } from "@zotlit/plugin-kernel/__fixtures__/log-capture.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import type { LogOutputs } from "@zotlit/plugin-kernel/effect-log.ts";
import { consoleLogSink } from "@zotlit/plugin-kernel/log-console.ts";

import { layerLogging, LogOutput, STARTUP_LOG_SETTINGS } from "./service.ts";

import { platformSettings } from "#__fixtures__/platform-settings.ts";
import { settingsOf } from "#__fixtures__/settings.ts";
import { PluginSettings } from "#obsidian/settings/service.ts";

class ConfigureFailed extends Schema.TaggedError<
  ConfigureFailed,
  { readonly brand: unique symbol }
>()("ConfigureFailed", { message: Schema.String }) {}

type LogConfig = LogOutputs;

const CONFIGURE_TIME = "1 second";

const logging = Effect.fnUntraced(function* (
  saved: Record<string, unknown> = {},
  options: { failFirstConfigure?: boolean } = {},
) {
  const events: string[] = [];
  const configs: LogConfig[] = [];
  const started = yield* Queue.unbounded<LogConfig>();
  let failNext = options.failFirstConfigure ?? false;
  const output = LogOutput.of({
    configureSync: (config) =>
      Effect.sync(() => {
        events.push("configureSync");
        configs.push(config);
      }),
    configure: (config) =>
      Effect.gen(function* () {
        events.push("configure");
        yield* Queue.offer(started, config);
        yield* Effect.sleep(CONFIGURE_TIME);
        if (failNext) {
          failNext = false;
          return yield* new ConfigureFailed({ message: "boom" });
        }
        events.push("configured");
        configs.push(config);
      }),
    reset: Effect.sync(() => {
      events.push("reset");
    }),
    openFile: Effect.acquireRelease(
      Effect.sync(() => {
        events.push("open file");
        return Logger.make(() => {});
      }),
      () => Effect.sync(() => events.push("close file")),
    ),
  });
  const plugin = stubService<Plugin>("Plugin", {
    app: stubService<App>("App", {}),
    loadData: async () => ({ __VERSION__: 11, ...saved }),
    saveData: async () => {},
  });
  const settings = yield* settingsOf({ plugin, definition: platformSettings });
  const layer = layerLogging.pipe(
    Layer.provide(Layer.succeed(LogOutput, output)),
    Layer.provide(Layer.succeed(PluginSettings, settings)),
  );
  return { layer, settings, events, configs, started };
});

const zotlitLogger = (config: LogConfig) => ({
  lowestLevel: config.level,
  sinks: config.sinks.map((sink) =>
    sink === consoleLogSink ? "console" : "file",
  ),
});

it.effect("logs to the console as soon as it builds", () =>
  Effect.gen(function* () {
    const { layer, events, configs, started } = yield* logging();
    yield* Layer.build(layer);

    expect(events).toEqual(["configureSync"]);
    expect(zotlitLogger(configs[0]!)).toMatchObject({
      sinks: ["console"],
      lowestLevel: STARTUP_LOG_SETTINGS.level,
    });
    yield* Queue.take(started);
    yield* TestClock.adjust(CONFIGURE_TIME);
  }),
);

it.effect("applies each change, closing the log file it turns off", () =>
  Effect.gen(function* () {
    const { layer, settings, events, started } = yield* logging({
      "log.level": "debug",
      "log.to-file": true,
    });
    yield* Layer.build(layer);

    expect(zotlitLogger(yield* Queue.take(started))).toMatchObject({
      sinks: ["console", "file"],
      lowestLevel: "debug",
    });
    yield* TestClock.adjust(CONFIGURE_TIME);

    yield* settings.update({ "log.to-file": false });
    expect(zotlitLogger(yield* Queue.take(started)).sinks).toEqual(["console"]);
    yield* TestClock.adjust(CONFIGURE_TIME);

    expect(events).toEqual([
      "configureSync",
      "open file",
      "configure",
      "configured",
      "close file",
      "configure",
      "configured",
    ]);
  }),
);

it.effect("routes nothing and opens no file when log.level is null", () =>
  Effect.gen(function* () {
    const { layer, events, started } = yield* logging({
      "log.level": null,
      "log.to-file": true,
    });
    yield* Layer.build(layer);

    expect(zotlitLogger(yield* Queue.take(started)).sinks).toEqual([]);
    yield* TestClock.adjust(CONFIGURE_TIME);
    expect(events).not.toContain("open file");
  }),
);

it.effect("applies only the newest of the changes made while one applies", () =>
  Effect.gen(function* () {
    const { layer, settings, started } = yield* logging({
      "log.level": "info",
    });
    yield* Layer.build(layer);
    yield* Queue.take(started);

    yield* settings.update({ "log.level": "debug" });
    yield* settings.update({ "log.level": "warning" });
    yield* settings.update({ "log.level": "error" });
    yield* TestClock.adjust(CONFIGURE_TIME);

    expect(zotlitLogger(yield* Queue.take(started)).lowestLevel).toBe("error");
    yield* TestClock.adjust(CONFIGURE_TIME);
  }),
);

it.effect(
  "closes after the change it is applying, then resets the logger",
  () =>
    Effect.gen(function* () {
      const { layer, events, started } = yield* logging({
        "log.to-file": true,
      });
      const scope = yield* Scope.make();
      yield* Layer.buildWithScope(layer, scope);
      yield* Queue.take(started);

      const closing = yield* Effect.forkChild(Scope.close(scope, Exit.void), {
        startImmediately: true,
      });
      yield* TestClock.adjust(CONFIGURE_TIME);
      yield* Fiber.join(closing);

      expect(events.slice(-3)).toEqual(["configured", "close file", "reset"]);
    }),
);

it.effect("reports a change it cannot apply and applies it again later", () =>
  Effect.gen(function* () {
    const { layer, settings, started } = yield* logging(
      { "log.level": "debug" },
      { failFirstConfigure: true },
    );
    const logs = yield* Effect.acquireDisposable(
      Effect.sync(() => captureLogRecords()),
    );
    yield* Layer.build(layer);
    yield* Queue.take(started);
    yield* TestClock.adjust(CONFIGURE_TIME);

    expect(
      logs.records.map(({ level, rawMessage, properties }) => ({
        level,
        rawMessage,
        error: properties["error"],
      })),
    ).toEqual([
      {
        level: "error",
        rawMessage: "Could not apply the log settings",
        error: new ConfigureFailed({ message: "boom" }),
      },
    ]);

    yield* settings.update({ "server.live-update": false });
    expect(zotlitLogger(yield* Queue.take(started)).lowestLevel).toBe("debug");
    yield* TestClock.adjust(CONFIGURE_TIME);
  }),
);
