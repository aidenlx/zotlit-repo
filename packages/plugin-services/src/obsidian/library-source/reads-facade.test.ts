import { expect, it } from "@effect/vitest";
import { Effect, Exit, Fiber, Queue, Scope, Stream } from "effect";
import { TestClock } from "effect/testing";

import type {
  ChangeEvent,
  ZoteroReadsClient,
} from "@zotlit/zotero-reads/contract/rpc.ts";
import { DbUnavailable } from "@zotlit/zotero-reads/contract/rpc.ts";

import { makeReadsFacade } from "./reads-facade.ts";

const fakeWorker = (events: readonly ChangeEvent[]) =>
  ({
    Changes: () => Stream.concat(Stream.fromIterable(events), Stream.never),
    Libraries: () => Effect.succeed([{ libraryID: 1 }]),
  }) as unknown as ZoteroReadsClient;

const collect = (client: ZoteroReadsClient) =>
  Effect.gen(function* () {
    const seen: string[] = [];
    yield* Stream.runForEach(client.Changes(), (event) =>
      Effect.sync(() => {
        seen.push(event._tag === "state" ? `state:${event.state}` : event._tag);
      }),
    ).pipe(Effect.forkScoped({ startImmediately: true }));
    yield* TestClock.adjust("0 millis");
    return seen;
  });

it.effect(
  "starts loading and holds reads until the start decides, answers with the reason while no Worker runs, then forwards the reads and the events of a started Worker",
  () =>
    Effect.gen(function* () {
      const facade = yield* makeReadsFacade();
      const seen = yield* collect(facade.client);
      expect(seen).toEqual(["state:loading"]);
      const held = yield* Effect.forkChild(
        Effect.flip(facade.client.Libraries({})),
      );
      yield* TestClock.adjust("0 millis");
      expect(held.pollUnsafe()).toBeUndefined();
      yield* facade.absent(new DbUnavailable({ message: "no key" }));
      expect(yield* Fiber.join(held)).toMatchObject({ message: "no key" });
      expect(seen).toEqual(["state:loading", "state:degraded"]);
      expect(yield* facade.client.Ping()).toBeUndefined();

      const worker = yield* Scope.make();
      yield* facade
        .attach(
          fakeWorker([{ _tag: "state", state: "ready", error: null }]),
          new DbUnavailable({ message: "stopped" }),
          Effect.void,
        )
        .pipe(Scope.provide(worker));
      yield* TestClock.adjust("0 millis");
      expect(seen).toEqual([
        "state:loading",
        "state:degraded",
        "state:ready",
        "changed",
      ]);
      expect(yield* facade.client.Libraries({})).toEqual([{ libraryID: 1 }]);

      yield* Scope.close(worker, Exit.void);
      yield* TestClock.adjust("0 millis");
      expect(seen.at(-1)).toBe("state:degraded");
      expect(yield* Effect.flip(facade.client.Libraries({}))).toMatchObject({
        message: "stopped",
      });
    }).pipe(Effect.scoped),
);

it.effect("starts a late subscriber with the present state", () =>
  Effect.gen(function* () {
    const facade = yield* makeReadsFacade();
    yield* facade.attach(
      fakeWorker([{ _tag: "state", state: "loading", error: null }]),
      new DbUnavailable({ message: "stopped" }),
      Effect.void,
    );
    yield* TestClock.adjust("0 millis");
    const first = yield* Stream.runHead(facade.client.Changes());
    expect(first).toMatchObject({
      value: { _tag: "state", state: "loading" },
    });
  }).pipe(Effect.scoped),
);

it.effect(
  "starts a late subscriber with ready after a loading Worker reports a change, and with degraded after it degrades",
  () =>
    Effect.gen(function* () {
      const facade = yield* makeReadsFacade();
      yield* facade.attach(
        fakeWorker([
          { _tag: "state", state: "loading", error: null },
          { _tag: "changed" },
        ]),
        new DbUnavailable({ message: "stopped" }),
        Effect.void,
      );
      yield* TestClock.adjust("0 millis");
      expect(yield* Stream.runHead(facade.client.Changes())).toMatchObject({
        value: { _tag: "state", state: "ready", error: null },
      });

      const second = yield* makeReadsFacade();
      const broken = new DbUnavailable({ message: "unreadable" });
      yield* second.attach(
        fakeWorker([
          { _tag: "state", state: "ready", error: null },
          { _tag: "degraded", error: broken },
        ]),
        new DbUnavailable({ message: "stopped" }),
        Effect.void,
      );
      yield* TestClock.adjust("0 millis");
      expect(yield* Stream.runHead(second.client.Changes())).toMatchObject({
        value: { _tag: "state", state: "degraded", error: broken },
      });
    }).pipe(Effect.scoped),
);

it.effect("tells the service when the change stream of the Worker fails", () =>
  Effect.gen(function* () {
    const facade = yield* makeReadsFacade();
    let lost = 0;
    yield* facade.attach(
      {
        Changes: () =>
          Stream.concat(
            Stream.succeed<ChangeEvent>({
              _tag: "state",
              state: "ready",
              error: null,
            }),
            Stream.fail(new DbUnavailable({ message: "transport closed" })),
          ),
      } as unknown as ZoteroReadsClient,
      new DbUnavailable({ message: "stopped" }),
      Effect.sync(() => {
        lost++;
      }),
    );
    yield* TestClock.adjust("0 millis");
    expect(lost).toBe(1);
  }).pipe(Effect.scoped),
);

it.effect(
  "answers a stream call in queue mode with the effect that yields a queue, from a started Worker and while no Worker runs",
  () =>
    Effect.gen(function* () {
      const facade = yield* makeReadsFacade();
      yield* facade.absent(new DbUnavailable({ message: "no key" }));
      const asQueue = { asQueue: true } as const;
      const absent = yield* facade.client.Snapshot(undefined, asQueue);
      expect(yield* Effect.flip(Queue.take(absent))).toMatchObject({
        message: "no key",
      });

      const worker = yield* Scope.make();
      yield* facade
        .attach(
          {
            ...fakeWorker([{ _tag: "state", state: "ready", error: null }]),
            Snapshot: (_payload: unknown, options?: { asQueue?: boolean }) =>
              options?.asQueue
                ? Stream.toQueue(Stream.make("snapshot-1"), { capacity: 16 })
                : Stream.make("snapshot-1"),
          } as unknown as ZoteroReadsClient,
          new DbUnavailable({ message: "stopped" }),
          Effect.void,
        )
        .pipe(Scope.provide(worker));
      const changes = yield* facade.client.Changes(undefined, asQueue);
      expect(yield* Queue.take(changes)).toMatchObject({ _tag: "state" });
      const attached = yield* facade.client.Snapshot(undefined, asQueue);
      expect(yield* Queue.take(attached)).toBe("snapshot-1");
      expect(yield* Stream.runCollect(facade.client.Snapshot())).toEqual([
        "snapshot-1",
      ]);
      yield* Scope.close(worker, Exit.void);
    }).pipe(Effect.scoped),
);
