import { it } from "@effect/vitest";
import { Stream } from "effect";
import { Effect } from "effect";
import { expect } from "vitest";

import { subscribe } from "@/lib/effect-stream.ts";
import * as lookupEvents from "@/services/citation-index/lookup-service.ts";
import { layerRcRef } from "@/services/zotero-reads/connection.ts";
import {
  inProcessClient,
  memoryOpener,
  seedWorksSql,
} from "@/services/zotero-reads/test-utils.ts";

import { lookupFixture } from "./__fixtures__.ts";

it.effect(
  "attaches before two immediate revisions and retains throwing listeners",
  () =>
    Effect.gen(function* () {
      let revision = 0;
      const f = yield* lookupFixture(
        Effect.map(
          inProcessClient(
            layerRcRef(
              memoryOpener(() =>
                seedWorksSql([
                  { itemID: 1, key: "ITEMKEY1", citationKey: "first" },
                ]),
              ).open,
            ),
          ),
          (client) => ({
            ...client,
            CitationLookup: ((
              ...args: Parameters<typeof client.CitationLookup>
            ) =>
              client.CitationLookup(...args).pipe(
                Effect.map((answer) => ({
                  ...answer,
                  revision: String(++revision),
                })),
              )) as typeof client.CitationLookup,
          }),
        ),
      );
      yield* Effect.promise(() =>
        f.service.bridge.runPromise(f.service.whenResolved),
      );
      const seen: string[] = [];
      let notifications = 0;
      const off = subscribe(
        f.runtime,
        Stream.drop(f.service.changes, 1),
        (state) => {
          seen.push(state.revision!);
          if (seen.length === 1) throw new Error("listener failed");
        },
      );
      const offEvent = subscribe(
        f.runtime,
        lookupEvents.lookupChanged(f.service),
        () => {
          notifications++;
          if (notifications === 1) throw new Error("event listener failed");
        },
      );
      yield* Effect.promise(() =>
        Promise.all([
          f.service.bridge.runPromise(f.service.read({})),
          f.service.bridge.runPromise(f.service.read({})),
        ]),
      );
      yield* Effect.promise(async () => {
        await expect.poll(() => seen.length).toBe(2);
      });
      expect(seen).toEqual(["2", "3"]);
      expect(notifications).toBe(2);
      off();
      offEvent();
      yield* Effect.promise(() =>
        f.service.bridge.runPromise(f.service.read({})),
      );
      expect(seen).toEqual(["2", "3"]);
      expect(notifications).toBe(2);
    }),
);
