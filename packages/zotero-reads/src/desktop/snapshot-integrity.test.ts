import { it } from "@effect/vitest";
import { Deferred, Effect, Exit, Fiber, Schema } from "effect";
import type { RpcMessage } from "effect/rpc";
import { TestClock } from "effect/testing";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, vi } from "vitest";

import { snapshotVerifier } from "./snapshot-integrity.ts";

import { DbUnavailable } from "#contract/rpc.ts";
import { SNAPSHOT_INTEGRITY_WORKER } from "#contract/worker-signal.ts";

const path = "/owned/snapshot.sqlite";
const workerUrl = "blob:interactive-worker";
const encodeReply = Schema.encodeSync(
  Schema.toCodecJson(Schema.Exit(Schema.Void, DbUnavailable, Schema.Defect())),
);

class FakeWorker extends EventTarget {
  static last: FakeWorker;
  static request = Deferred.makeUnsafe<RpcMessage.RequestEncoded>();
  readonly url: string;
  readonly options: WorkerOptions;
  terminate = vi.fn();
  postMessage = vi.fn((message: [0, RpcMessage.FromClientEncoded] | [1]) => {
    if (message[0] === 0 && message[1]._tag === "Request")
      Deferred.doneUnsafe(FakeWorker.request, Exit.succeed(message[1]));
  });

  constructor(url: string, options: WorkerOptions) {
    super();
    this.url = url;
    this.options = options;
    FakeWorker.last = this;
  }

  override addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ) {
    super.addEventListener(type, listener, options);
    if (type === "message")
      queueMicrotask(() =>
        this.dispatchEvent(new MessageEvent("message", { data: [0] })),
      );
  }

  reply(request: RpcMessage.RequestEncoded, exit: unknown) {
    this.dispatchEvent(
      new MessageEvent("message", {
        data: [1, { _tag: "Exit", requestId: request.id, exit }],
      }),
    );
  }
}

function start(worker: typeof Worker | typeof FakeWorker = FakeWorker) {
  FakeWorker.request = Deferred.makeUnsafe<RpcMessage.RequestEncoded>();
  vi.stubGlobal("Worker", worker);
  const createUrl = vi.spyOn(URL, "createObjectURL");
  const revoke = vi.spyOn(URL, "revokeObjectURL");
  const result = snapshotVerifier(workerUrl)(path);
  const released = () => {
    expect(FakeWorker.last.terminate).toHaveBeenCalledOnce();
    expect(createUrl).not.toHaveBeenCalled();
    expect(revoke).not.toHaveBeenCalled();
  };
  return { request: FakeWorker.request, result, released };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("snapshot integrity worker lifecycle", () => {
  it.effect("accepts a check in a dedicated worker using the parent URL", () =>
    Effect.gen(function* () {
      const { request, result, released } = start();
      const fiber = yield* Effect.forkChild(result);
      const call = yield* Deferred.await(request);
      expect(FakeWorker.last.url).toBe(workerUrl);
      expect(FakeWorker.last.options.name).toBe(SNAPSHOT_INTEGRITY_WORKER);
      expect(call.tag).toBe("Check");
      expect(call.payload).toEqual({ path });
      FakeWorker.last.reply(call, encodeReply(Exit.void));
      yield* Fiber.join(fiber);
      released();
    }),
  );

  it.effect("returns the SQLite failure and releases resources", () =>
    Effect.gen(function* () {
      const { request, result, released } = start();
      const fiber = yield* Effect.forkChild(result);
      const call = yield* Deferred.await(request);
      FakeWorker.last.reply(
        call,
        encodeReply(
          Exit.fail(new DbUnavailable({ message: "SQLite unavailable" })),
        ),
      );
      const error = yield* Fiber.join(fiber).pipe(Effect.flip);
      expect(error).toBeInstanceOf(DbUnavailable);
      expect(error.message).toBe("SQLite unavailable");
      released();
    }),
  );

  it.effect("rejects a malformed RPC reply and releases resources", () =>
    Effect.gen(function* () {
      const { request, result, released } = start();
      const fiber = yield* Effect.forkChild(result);
      const call = yield* Deferred.await(request);
      FakeWorker.last.reply(call, { _tag: "Success", value: "corrupt" });
      const error = yield* Fiber.join(fiber).pipe(Effect.flip);
      expect(error.message).toBe(
        "Invalid database snapshot verification reply",
      );
      released();
    }),
  );

  it.effect("propagates a worker startup error and releases resources", () =>
    Effect.gen(function* () {
      const { result, released } = start(
        class extends FakeWorker {
          constructor(url: string, options: WorkerOptions) {
            super(url, options);
            const event = new Event("error", { cancelable: true });
            Object.assign(event, { message: "Could not start worker" });
            queueMicrotask(() => this.dispatchEvent(event));
          }
        },
      );
      const error = yield* Effect.flip(result);
      expect(error.message).toBe("Could not start worker");
      released();
    }),
  );

  it.effect("propagates a worker message error and releases resources", () =>
    Effect.gen(function* () {
      const { request, result, released } = start();
      const fiber = yield* Effect.forkChild(result);
      yield* Deferred.await(request);
      FakeWorker.last.dispatchEvent(new MessageEvent("messageerror"));
      const error = yield* Fiber.join(fiber).pipe(Effect.flip);
      expect(error.message).toBe(
        "Invalid database snapshot verification reply",
      );
      released();
    }),
  );

  it.effect("terminates a validator that never replies", () =>
    Effect.gen(function* () {
      const { request, result, released } = start();
      const fiber = yield* Effect.forkChild(result);
      yield* Deferred.await(request);
      yield* TestClock.adjust("60 seconds");
      const error = yield* Fiber.join(fiber).pipe(Effect.flip);
      expect(error.message).toBe("Database snapshot verification timed out");
      released();
    }),
  );

  it.effect("terminates a validator when its caller is interrupted", () =>
    Effect.gen(function* () {
      const { request, result, released } = start();
      const fiber = yield* Effect.forkChild(result);
      yield* Deferred.await(request);
      yield* Fiber.interrupt(fiber);
      released();
    }),
  );

  it.effect("releases resources when sending the request fails", () =>
    Effect.gen(function* () {
      const { result, released } = start(
        class extends FakeWorker {
          override postMessage = vi.fn(
            (message: [0, RpcMessage.FromClientEncoded] | [1]) => {
              if (message[0] === 0 && message[1]._tag === "Request")
                throw Error("Cannot post path");
            },
          );
        },
      );
      const error = yield* Effect.flip(result);
      expect(error.message).toBe("Cannot post path");
      released();
    }),
  );

  it.effect("reports a worker construction failure", () =>
    Effect.gen(function* () {
      const { result } = start(
        class extends FakeWorker {
          constructor(url: string, options: WorkerOptions) {
            super(url, options);
            throw Error("Cannot create worker");
          }
        },
      );
      const error = yield* Effect.flip(result);
      expect(error.message).toBe("Cannot create worker");
    }),
  );
});

describe("snapshot integrity Node fallback", () => {
  it.effect(
    "disposes the SQLite connection after success and a query error",
    () =>
      Effect.gen(function* () {
        vi.stubGlobal("Worker", undefined);
        const dispose = vi.spyOn(DatabaseSync.prototype, Symbol.dispose);
        const verify = snapshotVerifier("unused");
        yield* verify(":memory:");
        expect(dispose).toHaveBeenCalledOnce();
        vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementationOnce(
          () => {
            throw new Error("Cannot read snapshot");
          },
        );
        const error = yield* Effect.flip(verify(":memory:"));
        expect(error.message).toBe("Cannot read snapshot");
        expect(dispose).toHaveBeenCalledTimes(2);
      }),
  );
});
