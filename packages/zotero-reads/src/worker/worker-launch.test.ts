import { Effect, Layer } from "effect";
import { Rpc, RpcGroup, RpcServer } from "effect/rpc";
import { expect, it, vi } from "vitest";

import type { WorkerScope } from "./worker-launch.ts";
import { launchWorker } from "./worker-launch.ts";

import { WORKER_CLOSED } from "#contract/worker-signal.ts";

const Group = RpcGroup.make(Rpc.make("Ping"));

function fakeScope() {
  const target = new EventTarget();
  const events: unknown[] = [];
  const scope: WorkerScope = {
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    postMessage: (data: unknown) => events.push(data),
    close: () => events.push("scope closed"),
  };
  const send = (data: unknown) =>
    target.dispatchEvent(new MessageEvent("message", { data }));
  return { scope, events, send };
}

it("answers the renderer's close message once its cleanup ran, and closes its scope last", async () => {
  const { scope, events, send } = fakeScope();
  const cleanup = Layer.effectDiscard(
    Effect.addFinalizer(() => Effect.sync(() => events.push("cleanup"))),
  );
  launchWorker(
    scope,
    RpcServer.layer(Group).pipe(
      Layer.provide(Group.toLayer({ Ping: () => Effect.void })),
      Layer.provide(cleanup),
    ),
  );
  await vi.waitFor(() => expect(events).toContainEqual([0]));

  send([1]);

  await vi.waitFor(() => expect(events).toContain("scope closed"));
  expect(events.filter((event) => typeof event === "string")).toEqual([
    "cleanup",
    WORKER_CLOSED,
    "scope closed",
  ]);
});
