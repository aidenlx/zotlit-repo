import { it } from "@effect/vitest";
import { Effect, Exit, Scope } from "effect";
import { TestClock, TestConsole } from "effect/testing";
import type { DataAdapter } from "obsidian";
import { describe, expect } from "vitest";

import { eventually } from "@zotlit/plugin-kernel/__fixtures__/eventually.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import {
  currentLogOutputs,
  setLogOutputs,
} from "@zotlit/plugin-kernel/effect-log.ts";

import { openVaultFileSink } from "./vault-sink.ts";

function makeAdapter(append?: (data: string) => Promise<void>) {
  const writeCalls: string[] = [];
  const appendCalls: string[] = [];
  const adapter = stubService<DataAdapter>("Adapter", {
    write: async (_path, data) => {
      writeCalls.push(data);
    },
    append:
      append === undefined
        ? async (_path, data) => {
            appendCalls.push(data);
          }
        : (_path, data) => append(data),
  });
  return { adapter, writeCalls, appendCalls };
}

const openFileLogging = (adapter: DataAdapter) =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const sink = yield* openVaultFileSink(adapter, "log.jsonl").pipe(
      Scope.provide(scope),
    );
    const previous = currentLogOutputs();
    setLogOutputs({ level: "trace", sinks: [sink] });
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => setLogOutputs(previous)),
    );
    return { close: Scope.close(scope, Exit.void) };
  });

const errorLinesUntil = (line: string) =>
  TestConsole.errorLines.pipe(
    Effect.tap(() => Effect.yieldNow),
    Effect.repeat({
      until: (lines) => lines.includes(line),
      times: 1000,
    }),
  );

describe("openVaultFileSink", () => {
  it.effect("truncates the file on open", () =>
    Effect.gen(function* () {
      const { adapter, writeCalls } = makeAdapter();
      yield* openFileLogging(adapter);
      expect(writeCalls).toEqual([""]);
    }).pipe(Effect.scoped),
  );

  it.effect("buffers records and appends them once a second", () =>
    Effect.gen(function* () {
      const { adapter, appendCalls } = makeAdapter();
      yield* openFileLogging(adapter);

      yield* Effect.logInfo("a");
      yield* Effect.logInfo("b");
      expect(appendCalls).toHaveLength(0);

      yield* TestClock.adjust("1 second");
      yield* eventually(() => expect(appendCalls).toHaveLength(1));
      expect(appendCalls[0]).toContain('"message":"a"');
      expect(appendCalls[0]).toContain('"message":"b"');
      expect(appendCalls[0]?.endsWith("\n")).toBe(true);
    }).pipe(Effect.scoped),
  );

  it.effect("drains pending records when its scope closes", () =>
    Effect.gen(function* () {
      const { adapter, appendCalls } = makeAdapter();
      const file = yield* openFileLogging(adapter);

      yield* Effect.logInfo("only");
      yield* file.close;

      expect(appendCalls).toHaveLength(1);
      expect(appendCalls[0]).toContain('"message":"only"');
    }).pipe(Effect.scoped),
  );

  it.effect(
    "reports a failed append and appends the next records on a later tick",
    () =>
      Effect.gen(function* () {
        let calls = 0;
        const appended: string[] = [];
        const { adapter } = makeAdapter(async (data) => {
          calls += 1;
          if (calls === 1) throw new Error("disk full");
          appended.push(data);
        });
        yield* openFileLogging(adapter);

        yield* Effect.logInfo("a");
        yield* TestClock.adjust("1 second");
        expect(
          yield* errorLinesUntil("Failed to write to plugin log file"),
        ).toContain("Failed to write to plugin log file");

        yield* Effect.logInfo("b");
        yield* TestClock.adjust("1 second");
        yield* eventually(() =>
          expect(appended).toContainEqual(expect.stringContaining('"b"')),
        );
      }).pipe(Effect.scoped),
  );
});
