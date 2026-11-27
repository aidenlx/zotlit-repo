import { expect, it } from "@effect/vitest";
import { Effect, Fiber, PubSub, Stream } from "effect";
import { TestClock } from "effect/testing";

import { windowFocus } from "./focus.ts";
import type { FocusWindow, WindowChange } from "./focus.ts";

class FakeWindow extends EventTarget implements FocusWindow {
  focused = false;
  readonly document = { hasFocus: () => this.focused };
  focus() {
    this.focused = true;
    this.dispatchEvent(new Event("focus"));
  }
  blur() {
    this.focused = false;
    this.dispatchEvent(new Event("blur"));
  }
}

it.effect("counts a focused popout window of the app as focus", () =>
  Effect.gen(function* () {
    const main = new FakeWindow();
    main.focused = true;
    const popout = new FakeWindow();
    const changes = yield* PubSub.unbounded<WindowChange>();
    const seen: boolean[] = [];
    const fiber = yield* Stream.runForEach(
      windowFocus(Stream.fromPubSub(changes), Effect.succeed([main]), main),
      (on) =>
        Effect.sync(() => {
          seen.push(on);
        }),
    ).pipe(Effect.forkChild({ startImmediately: true }));
    yield* TestClock.adjust("0 millis");
    yield* PubSub.publish(changes, { _tag: "window-open", window: popout });
    yield* TestClock.adjust("0 millis");
    main.blur();
    popout.focus();
    yield* TestClock.adjust("0 millis");
    expect(seen.at(-1)).toBe(true);
    popout.blur();
    yield* TestClock.adjust("0 millis");
    expect(seen.at(-1)).toBe(false);
    yield* PubSub.publish(changes, { _tag: "window-close", window: popout });
    yield* TestClock.adjust("0 millis");
    popout.focus();
    yield* TestClock.adjust("0 millis");
    expect(seen.at(-1)).toBe(false);
    yield* Fiber.interrupt(fiber);
  }),
);

it.effect("counts a popout window that was open before the subscription", () =>
  Effect.gen(function* () {
    const main = new FakeWindow();
    const popout = new FakeWindow();
    const seen: boolean[] = [];
    const fiber = yield* Stream.runForEach(
      windowFocus(Stream.never, Effect.succeed([main, popout]), main),
      (on) =>
        Effect.sync(() => {
          seen.push(on);
        }),
    ).pipe(Effect.forkChild({ startImmediately: true }));
    yield* TestClock.adjust("0 millis");
    expect(seen.at(-1)).toBe(false);
    popout.focus();
    yield* TestClock.adjust("0 millis");
    expect(seen.at(-1)).toBe(true);
    yield* Fiber.interrupt(fiber);
  }),
);
