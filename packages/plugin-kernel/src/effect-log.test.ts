import { it } from "@effect/vitest";
import { Clock, DateTime, Effect, Layer, Logger, Queue } from "effect";
import { describe, expect } from "vitest";

import { logLibrary } from "@zotlit/shared/logging";

import { capturedLogQueue } from "./__fixtures__/log-capture.ts";
import { layerHostLogPort } from "./effect-log-port.ts";
import type { LogMessagePort, LogPortRecord } from "./effect-log-port.ts";
import { pluginLogger, withLogCategory } from "./effect-log.ts";

const WORKER_LOG_TIME = DateTime.toEpochMillis(
  DateTime.makeUnsafe("2001-02-03T04:05:06Z"),
);

const hostPort = (): LogMessagePort => ({
  onmessage: null,
  postMessage: () => undefined,
  close: () => undefined,
});

const workerRecord = (
  overrides: Partial<LogPortRecord> = {},
): LogPortRecord => ({
  level: "Warn",
  category: ["zotlit", "db", "tags"],
  message: "Unknown tag type {type}",
  details: [],
  annotations: { type: 99 },
  error: null,
  timestamp: WORKER_LOG_TIME,
  ...overrides,
});

describe("pluginLogger", () => {
  it.effect("keeps the worker's timestamp on a record the host re-emits", () =>
    Effect.gen(function* () {
      const captured = yield* capturedLogQueue;
      const port = hostPort();
      yield* Layer.build(
        layerHostLogPort(port, {
          malformedMessage: "malformed",
          category: ["zotero-reads"],
        }),
      );

      port.onmessage?.({ data: workerRecord() } as MessageEvent);
      const record = yield* Queue.take(captured);

      expect(record.timestamp).toBe(WORKER_LOG_TIME);
      expect(record.level).toBe("warning");
      expect(record.category).toEqual(["zotlit", "db", "tags"]);
      expect(record.message).toEqual(["Unknown tag type ", 99, ""]);
      expect(record.properties).toEqual({ type: 99 });
    }).pipe(Effect.scoped, Effect.provide(Logger.layer([pluginLogger]))),
  );

  it.effect(
    "renders the template of a record without a LogTimestamp at the Effect clock's time",
    () =>
      Effect.gen(function* () {
        const captured = yield* capturedLogQueue;

        yield* Effect.logInfo("Opened {library.name}").pipe(
          Effect.annotateLogs({ library: { name: "ABCD" } }),
          withLogCategory("zotlit", "db"),
        );
        const record = yield* Queue.take(captured);

        expect(record.message).toEqual(["Opened ", "ABCD", ""]);
        expect(record.timestamp).toBe(yield* Clock.currentTimeMillis);
      }).pipe(Effect.scoped, Effect.provide(Logger.layer([pluginLogger]))),
  );
});

describe("library log sink in the renderer", () => {
  it.effect(
    "reaches the plugin logger through the sink the bridge installs",
    () =>
      Effect.gen(function* () {
        const captured = yield* capturedLogQueue;

        logLibrary({
          level: "warn",
          category: ["zotlit", "db", "tags"],
          message: "Unknown tag type {type}",
          properties: { type: 99 },
        });
        const record = yield* Queue.take(captured);

        expect(record.level).toBe("warning");
        expect(record.category).toEqual(["zotlit", "db", "tags"]);
        expect(record.message).toEqual(["Unknown tag type ", 99, ""]);
      }).pipe(Effect.scoped),
  );
});
