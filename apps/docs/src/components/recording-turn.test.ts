import { beforeEach, expect, it, vi } from "vitest";

beforeEach(() => vi.resetModules());

it("starts an automatic loop when the reader-paused holder ends", async () => {
  const { askTurn, endTurn, holdTurn, takeTurn } =
    await import("./recording-turn.ts");
  const paused = Symbol();
  const next = Symbol();
  const restPaused = vi.fn();
  const loop = { rest: vi.fn(), start: vi.fn(() => true) };
  takeTurn(paused, { rest: restPaused });
  holdTurn(paused);

  askTurn(next, loop);
  expect(loop.start).not.toHaveBeenCalled();
  expect(restPaused).not.toHaveBeenCalled();

  endTurn(paused);
  expect(loop.start).toHaveBeenCalledOnce();
});

it("gives the reader's start the turn immediately despite a reader pause", async () => {
  const { askTurn, holdTurn, takeTurn } = await import("./recording-turn.ts");
  const paused = Symbol();
  const restPaused = vi.fn();
  const pressed = { rest: vi.fn(), start: vi.fn(() => true) };
  takeTurn(paused, { rest: restPaused });
  holdTurn(paused);

  takeTurn(Symbol(), pressed);
  expect(pressed.start).toHaveBeenCalledOnce();
  expect(restPaused).not.toHaveBeenCalled();

  askTurn(Symbol(), { rest: vi.fn(), start: vi.fn(() => true) });
  expect(pressed.rest).toHaveBeenCalledOnce();
});

it("resumes a displaced loop that can start again when the new holder ends", async () => {
  const { askTurn, endTurn, takeTurn } = await import("./recording-turn.ts");
  const previous = { rest: vi.fn(), start: vi.fn(() => true) };
  const next = Symbol();

  askTurn(Symbol(), previous);
  takeTurn(next, { rest: vi.fn() });
  expect(previous.rest).toHaveBeenCalledOnce();
  expect(previous.start).toHaveBeenCalledOnce();

  endTurn(next);
  expect(previous.start).toHaveBeenCalledTimes(2);
});

it("rests a reader-started loop without a start callback when displaced", async () => {
  const { askTurn, endTurn, takeTurn } = await import("./recording-turn.ts");
  const reader = { rest: vi.fn() };
  const next = Symbol();
  const following = { rest: vi.fn(), start: vi.fn(() => true) };

  takeTurn(Symbol(), reader);
  askTurn(next, { rest: vi.fn(), start: vi.fn(() => true) });
  expect(reader.rest).toHaveBeenCalledOnce();

  endTurn(next);
  askTurn(Symbol(), following);
  expect(following.start).toHaveBeenCalledOnce();
  expect(reader.rest).toHaveBeenCalledOnce();
});

it.each([
  ["synchronous", false, 1],
  ["asynchronous", true, 0],
] as const)(
  "passes a %s refusal to the first waiter without retrying it",
  async (_, asynchronous, startsBeforeResolution) => {
    const { askTurn, endTurn, holdTurn, takeTurn } =
      await import("./recording-turn.ts");
    const paused = Symbol();
    const first = Symbol();
    const second = Symbol();
    const outcome = Promise.withResolvers<boolean>();
    const refused = {
      rest: vi.fn(),
      start: vi.fn(() => (asynchronous ? outcome.promise : false)),
    };
    const firstWaiter = { rest: vi.fn(), start: vi.fn(() => true) };
    const secondWaiter = { rest: vi.fn(), start: vi.fn(() => true) };
    takeTurn(paused, { rest: vi.fn() });
    holdTurn(paused);
    askTurn(Symbol(), refused);
    askTurn(first, firstWaiter);
    askTurn(second, secondWaiter);

    endTurn(paused);
    expect(firstWaiter.start).toHaveBeenCalledTimes(startsBeforeResolution);
    outcome.resolve(false);
    await outcome.promise;
    expect(firstWaiter.start).toHaveBeenCalledOnce();
    expect(secondWaiter.start).not.toHaveBeenCalled();

    endTurn(first);
    expect(secondWaiter.start).toHaveBeenCalledOnce();
    endTurn(second);
    expect(refused.start).toHaveBeenCalledOnce();
  },
);

it("resumes a displaced demo when the recording that took its turn cannot start", async () => {
  const { askTurn } = await import("./recording-turn.ts");
  const demo = { rest: vi.fn(), start: vi.fn(() => true) };
  const outcome = Promise.withResolvers<boolean>();
  const recording = { rest: vi.fn(), start: vi.fn(() => outcome.promise) };

  askTurn(Symbol(), demo);
  askTurn(Symbol(), recording);
  expect(demo.rest).toHaveBeenCalledOnce();
  expect(demo.start).toHaveBeenCalledOnce();

  outcome.resolve(false);
  await outcome.promise;
  expect(demo.start).toHaveBeenCalledTimes(2);
  expect(recording.start).toHaveBeenCalledOnce();
});

it("drops a waiting loop that ends before the turn is released", async () => {
  const { askTurn, endTurn, holdTurn, takeTurn } =
    await import("./recording-turn.ts");
  const paused = Symbol();
  const leaving = Symbol();
  const loop = { rest: vi.fn(), start: vi.fn(() => true) };
  takeTurn(paused, { rest: vi.fn() });
  holdTurn(paused);
  askTurn(leaving, loop);

  endTurn(leaving);
  endTurn(paused);
  expect(loop.start).not.toHaveBeenCalled();
});

it("drops a displaced loop whose pending start is refused", async () => {
  const { askTurn, endTurn } = await import("./recording-turn.ts");
  const outcome = Promise.withResolvers<boolean>();
  const refused = { rest: vi.fn(), start: vi.fn(() => outcome.promise) };
  const next = Symbol();
  askTurn(Symbol(), refused);
  askTurn(next, { rest: vi.fn(), start: vi.fn(() => true) });
  expect(refused.rest).toHaveBeenCalledOnce();

  outcome.resolve(false);
  await outcome.promise;
  endTurn(next);
  expect(refused.start).toHaveBeenCalledOnce();
});
