import * as Context from "effect/Context";
import * as Logger from "effect/Logger";
import * as Ref from "effect/Ref";
import { expect, it } from "vitest";

import { makePortLogger } from "./effect-log-port.ts";
import type { LogPortRecord, PortLogLevel } from "./effect-log-port.ts";
import * as WorkerEffect from "./effect-worker-runtime.ts";

const portLoggerContext = (posted: LogPortRecord[]) =>
  Context.make(
    Logger.CurrentLoggers,
    new Set([
      makePortLogger(
        { postMessage: (record) => void posted.push(record as LogPortRecord) },
        Ref.makeUnsafe<PortLogLevel | null>("trace"),
      ),
    ]),
  );

const logLowLevels = WorkerEffect.gen(function* () {
  yield* WorkerEffect.logTrace("trace record");
  yield* WorkerEffect.logDebug("debug record");
});

it("forwards debug and trace records from the async worker entry point", async () => {
  const posted: LogPortRecord[] = [];
  await WorkerEffect.runPromiseWith(portLoggerContext(posted))(logLowLevels);
  expect(posted.map(({ level, message }) => [level, message])).toEqual([
    ["Trace", "trace record"],
    ["Debug", "debug record"],
  ]);
});

it("forwards debug and trace records from the sync worker entry point", () => {
  const posted: LogPortRecord[] = [];
  WorkerEffect.runSyncWith(portLoggerContext(posted))(logLowLevels);
  expect(posted.map(({ message }) => message)).toEqual([
    "trace record",
    "debug record",
  ]);
});
