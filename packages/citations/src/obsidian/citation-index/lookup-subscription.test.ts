import { it } from "@effect/vitest";
import { Stream } from "effect";
import { Effect } from "effect";
import { expect } from "vitest";

import { subscribe } from "@zotlit/plugin-kernel/effect-stream.ts";
import { LibraryScope } from "@zotlit/plugin-services/obsidian/library-scope/service.ts";
import {
  inProcessClient,
  memoryOpener,
  seedWorksSql,
} from "@zotlit/zotero-reads/__fixtures__/in-process.ts";
import { layerRcRef } from "@zotlit/zotero-reads/worker/connection.ts";

import * as lookupEvents from "./lookup-service.ts";

import { lookupFixture } from "#__fixtures__/citation-index.ts";

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
      yield* Stream.runHead(
        f.runtime
          .runSync(LibraryScope)
          .changes.pipe(Stream.filter((state) => state.current !== null)),
      );
      yield* Effect.promise(() =>
        f.service.bridge.runPromise(f.service.whenResolved),
      );
      const base = Number(f.service.bridge.runSync(f.service.current).revision);
      const next = [String(base + 1), String(base + 2)];
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
      expect(seen).toEqual(next);
      expect(notifications).toBe(2);
      off();
      offEvent();
      yield* Effect.promise(() =>
        f.service.bridge.runPromise(f.service.read({})),
      );
      expect(seen).toEqual(next);
      expect(notifications).toBe(2);
    }),
);
