import { it } from "@effect/vitest";
import { Context, Deferred, Effect, Fiber, Layer } from "effect";
import { describe, expect } from "vitest";

import { USER_LIBRARY_ID } from "@zotlit/db";

import { makeMemoryItemRow as item } from "./fixtures.ts";
import { ItemSource } from "./item-index.ts";
import { makeMemoryItemSource } from "./memory-item-source.ts";

const alpha = item({ key: "ALPHA", itemID: 1, title: "Alpha" });
const beta = item({ key: "BETA", itemID: 2, title: "Beta" });

const pinnedSource = Effect.gen(function* () {
  const source = yield* makeMemoryItemSource(
    new Map([[USER_LIBRARY_ID, [alpha]]]),
  );
  const itemSource = Context.get(yield* Layer.build(source.layer), ItemSource);
  return { source, itemSource };
});

describe("the memory item source", () => {
  it.effect("runs two publications at once, as two read borrows do", () =>
    Effect.gen(function* () {
      const { itemSource } = yield* pinnedSource;
      const first = yield* itemSource.pinned;
      const second = yield* itemSource.pinned;
      const firstRunning = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const held = yield* first
        .whileCurrent(
          Deferred.succeed(firstRunning, undefined).pipe(
            Effect.andThen(Deferred.await(release)),
          ),
        )
        .pipe(Effect.forkChild({ startImmediately: true }));
      yield* Deferred.await(firstRunning);
      expect(yield* second.whileCurrent(Effect.succeed("published"))).toBe(
        "published",
      );
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(held);
    }).pipe(Effect.scoped),
  );

  it.effect("holds a commit until a running publication ends", () =>
    Effect.gen(function* () {
      const { source, itemSource } = yield* pinnedSource;
      const pinned = yield* itemSource.pinned;
      const running = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const committed = yield* Deferred.make<void>();
      const publication = yield* pinned
        .whileCurrent(
          Deferred.succeed(running, undefined).pipe(
            Effect.andThen(Deferred.await(release)),
          ),
        )
        .pipe(Effect.forkChild({ startImmediately: true }));
      yield* Deferred.await(running);
      const commit = yield* source
        .commit(USER_LIBRARY_ID, [alpha, beta])
        .pipe(
          Effect.andThen(Deferred.succeed(committed, undefined)),
          Effect.forkChild({ startImmediately: true }),
        );
      expect(commit.pollUnsafe()).toBeUndefined();
      expect(yield* Deferred.isDone(committed)).toBe(false);
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(publication);
      yield* Fiber.join(commit);
      expect(yield* Deferred.isDone(committed)).toBe(true);
    }).pipe(Effect.scoped),
  );
});
