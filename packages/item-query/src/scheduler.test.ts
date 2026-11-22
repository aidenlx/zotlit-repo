import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import { ItemQueryScheduler, ItemQuerySliceObserver } from "./scheduler.ts";

function work(steps: number, stepMs: number, clock: { now: number }) {
  return Effect.gen(function* () {
    for (let i = 0; i < steps; i++) {
      yield* Effect.sync(() => {
        clock.now += stepMs;
      });
    }
    return steps;
  });
}

describe("ItemQueryScheduler", () => {
  it("pauses a fiber when a slice has used its 8 ms time budget", async () => {
    const clock = { now: 0 };
    const slices: number[] = [];
    let sliceStart = 0;
    const scheduler = new ItemQueryScheduler({
      budgetMs: 8,
      now: () => clock.now,
      pause: (resume) => {
        slices.push(clock.now - sliceStart);
        const timer = setImmediate(() => {
          sliceStart = clock.now;
          resume();
        });
        return () => clearImmediate(timer);
      },
    });

    const result = await Effect.runPromise(work(40, 3, clock), { scheduler });

    expect(result).toBe(40);
    expect(slices).toEqual(Array.from({ length: 13 }, () => 9));
  });

  it("runs a short query as one slice", async () => {
    const clock = { now: 0 };
    const pause = vi.fn((resume: () => void) => {
      const timer = setImmediate(resume);
      return () => clearImmediate(timer);
    });
    const scheduler = new ItemQueryScheduler({ now: () => clock.now, pause });

    await Effect.runPromise(work(2, 1, clock), { scheduler });

    expect(pause).not.toHaveBeenCalled();
  });

  it("pauses with a MessageChannel task by default", async () => {
    const clock = { now: 0 };
    using post = vi.spyOn(MessagePort.prototype, "postMessage");
    using immediate = vi.spyOn(globalThis, "setImmediate");
    using timeout = vi.spyOn(globalThis, "setTimeout");
    const scheduler = new ItemQueryScheduler({ now: () => clock.now });

    const result = await Effect.runPromise(work(40, 3, clock), { scheduler });

    expect(result).toBe(40);
    expect(post).toHaveBeenCalledTimes(20);
    expect(immediate).not.toHaveBeenCalled();
    expect(timeout).not.toHaveBeenCalled();
  });

  it("reports each pause and each resume to the slice observer of the run", async () => {
    const clock = { now: 0 };
    const events: [string, number][] = [];
    const scheduler = new ItemQueryScheduler({
      budgetMs: 8,
      now: () => clock.now,
      pause: (resume) => {
        const timer = setImmediate(() => {
          clock.now += 5;
          resume();
        });
        return () => clearImmediate(timer);
      },
    });

    await Effect.runPromise(
      Effect.provideService(work(6, 3, clock), ItemQuerySliceObserver, {
        paused: (at) => events.push(["paused", at]),
        resumed: (at) => events.push(["resumed", at]),
      }),
      { scheduler },
    );

    expect(events).toEqual([
      ["paused", 9],
      ["resumed", 14],
      ["paused", 23],
      ["resumed", 28],
    ]);
  });

  it("closes each MessageChannel it opens when no resume waits", async () => {
    const clock = { now: 0 };
    let opened = 0;
    using stubs = new DisposableStack();
    stubs.defer(() => vi.unstubAllGlobals());
    vi.stubGlobal(
      "MessageChannel",
      class extends MessageChannel {
        constructor() {
          super();
          opened += 1;
        }
      },
    );
    using close = vi.spyOn(MessagePort.prototype, "close");
    const scheduler = new ItemQueryScheduler({ now: () => clock.now });

    await Effect.runPromise(work(40, 3, clock), { scheduler });

    expect(opened).toBe(20);
    expect(close).toHaveBeenCalledTimes(20);
  });
});
