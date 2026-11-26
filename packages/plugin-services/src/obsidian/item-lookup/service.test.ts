import type { ResourcePackHostPorts } from "#obsidian/managed-binary/pack-platform.ts";
// @vitest-environment happy-dom
import { it } from "@effect/vitest";
import {
  Context,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Queue,
  Scope,
  Stream,
  SubscriptionRef,
} from "effect";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { describe, expect } from "vitest";

import { USER_LIBRARY_ID } from "@zotlit/db";
import { testNotifier } from "@zotlit/obsidian-kit/__fixtures__/notifier.ts";
import { eventually } from "@zotlit/plugin-kernel/__fixtures__/eventually.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { PACK_COMPAT } from "@zotlit/resource-pack/format.ts";
import type { ReadRange } from "@zotlit/resource-pack/reader.ts";
import {
  inProcessClient,
  memoryOpener,
} from "@zotlit/zotero-reads/__fixtures__/in-process.ts";
import { layerZoteroReads } from "@zotlit/zotero-reads/client/service.ts";
import type { AvailableLibrary } from "@zotlit/zotero-reads/contract/library-scope.ts";
import type { ZoteroReadsClient } from "@zotlit/zotero-reads/contract/rpc.ts";
import { layerRcRef } from "@zotlit/zotero-reads/worker/connection.ts";
import type { HandlersOptions } from "@zotlit/zotero-reads/worker/handlers.ts";

import {
  layerLibraryScopeOf,
  layerTestItemLookup,
  scopeState,
} from "./__fixtures__.ts";
import { ItemLookup } from "./service.ts";
import type { SearchHit } from "./service.ts";

import {
  layerDeviceSegmenter,
  segmenterHandlers,
} from "#obsidian/chinese-segmenter/__fixtures__.ts";
import { ChineseSegmenter } from "#obsidian/chinese-segmenter/service.ts";
import { packDevice, packFile } from "#obsidian/managed-binary/__fixtures__.ts";

const nextTurn = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const keys = (hits: readonly SearchHit[]) => hits.map((hit) => hit.item.key);

const JIEBA = new Uint8Array(
  await readFile(
    join(
      dirname(createRequire(import.meta.url).resolve("jieba-wasm/web")),
      "jieba_rs_wasm_bg.wasm",
    ),
  ),
);

const CHINESE_TITLE = "长江流域的城市化研究";

describe("ItemLookup", () => {
  it.effect(
    "states the Chinese Segmenter that the worker runs when the worker cannot read the pack",
    () =>
      Effect.gen(function* () {
        const device = packDevice(
          yield* Effect.promise(() => packFile({ "chinese-segmenter": JIEBA })),
        );
        const reads = yield* readsOver(
          () => seed(perLibraryRows(), CHINESE_TITLE),
          {
            chineseSegmenter: {
              ...(yield* device.locate)!,
              entry: "chinese-segmenter",
            },
            readSegmenter: () =>
              Effect.fail({
                kind: "pack-unreadable",
                detail: "The worker's request for the pack file failed",
              } as const),
          },
        );
        const { lookup, segmenter } = yield* lookupOver(
          reads,
          [library(USER_LIBRARY_ID)],
          device,
        );

        expect(keys(yield* lookup.search("长江流域"))).toEqual(["LIBRARY2"]);
        expect(keys(yield* lookup.search("流域"))).toEqual([]);
        expect(yield* segmenter!.check).toEqual({ kind: "pack-damaged" });
      }),
  );

  it.effect(
    "stops the binary in the worker at a status read that finds the pack gone, with no report from Obsidian",
    () =>
      Effect.gen(function* () {
        const device = packDevice(
          yield* Effect.promise(() => packFile({ "chinese-segmenter": JIEBA })),
        );
        const reads = yield* readsOver(
          () => seed(perLibraryRows(), CHINESE_TITLE),
          segmenterHandlers(device),
        );
        const { lookup, segmenter } = yield* lookupOver(
          reads,
          [library(USER_LIBRARY_ID)],
          device,
        );
        expect(yield* segmenter!.check).toEqual({
          kind: "ready",
          version: "1.0.0",
        });
        expect(keys(yield* lookup.search("长江流域"))).toEqual(["LIBRARY2"]);
        while (keys(yield* lookup.search("流域")).length === 0)
          yield* Effect.promise(() => nextTurn());

        device.install(null);

        expect(yield* segmenter!.check).toEqual({ kind: "pack-absent" });
        while (keys(yield* lookup.search("流域")).length > 0)
          yield* Effect.promise(() => nextTurn());
      }),
  );

  it.effect(
    "names the Resource Pack once when a search of Chinese text finds no pack",
    () =>
      Effect.gen(function* () {
        const reads = yield* readsOver(() => seed(perLibraryRows()));
        const { lookup, notices } = yield* lookupOver(
          reads,
          [library(USER_LIBRARY_ID)],
          packDevice(null),
        );

        yield* lookup.search("Alpha");
        expect(notices()).toEqual([]);
        yield* lookup.search("长江");
        yield* lookup.search("流域");

        yield* eventually(() =>
          expect(notices()).toEqual([
            m.notice_resource_pack() + m.settings_resource_pack_status_absent(),
          ]),
        );
      }),
  );

  it.effect(
    "reads the installed pack at the first search of Chinese text, and names the plugin to update when the pack is too new",
    () =>
      Effect.gen(function* () {
        const device = packDevice(
          yield* Effect.promise(() =>
            packFile(
              { "chinese-segmenter": new Uint8Array([0]) },
              PACK_COMPAT + 1,
            ),
          ),
        );
        const reads = yield* readsOver(
          () => seed(perLibraryRows()),
          segmenterHandlers(device),
        );
        const { lookup, notices } = yield* lookupOver(
          reads,
          [library(USER_LIBRARY_ID)],
          device,
        );

        yield* lookup.search("长江");

        yield* eventually(() =>
          expect(notices()).toEqual([
            m.notice_resource_pack() +
              m.settings_resource_pack_status_plugin_outdated(),
          ]),
        );
      }),
  );

  for (const [name, searches] of [
    [
      "one-shot searches started together",
      (lookup: ItemLookup["Service"]) =>
        Effect.forEach(
          ["长", "长江", "长江流"],
          (query) => lookup.search(query),
          {
            concurrency: "unbounded",
          },
        ),
    ],
    [
      "the keystrokes of one Search Session, each a turn after the one before",
      (lookup: ItemLookup["Service"]) =>
        Effect.gen(function* () {
          const session = yield* lookup.openSession;
          const typed = yield* Effect.forEach(
            ["长", "长江", "长江流"],
            (query) =>
              Effect.forkChild(session.search(query)).pipe(
                Effect.tap(() => Effect.promise(() => nextTurn())),
              ),
          );
          yield* Fiber.joinAll(typed);
        }).pipe(Effect.scoped),
    ],
  ] as const) {
    it.effect(
      `asks the worker for one read of the installed pack for ${name} while the Segmenter's status is unknown`,
      () =>
        Effect.gen(function* () {
          const installed = packDevice(
            yield* Effect.promise(() =>
              packFile({ "chinese-segmenter": JIEBA }),
            ),
          );
          const held = Promise.withResolvers<void>();
          let packReads = 0;
          const device = {
            ...installed,
            open: (url: string): ReadRange => {
              const range = installed.open(url);
              return async (offset, length) => {
                if (offset === 0) packReads += 1;
                await held.promise;
                return range(offset, length);
              };
            },
          };
          const reads = yield* readsOver(
            () => seed(perLibraryRows()),
            segmenterHandlers(device),
          );
          const { lookup, segmenter } = yield* lookupOver(
            reads,
            [library(USER_LIBRARY_ID)],
            device,
          );

          yield* searches(lookup);
          held.resolve();

          yield* Stream.runHead(
            Stream.filter(
              segmenter!.changes,
              (status) => status.kind === "ready",
            ),
          );
          expect(packReads).toBe(1);
        }),
    );
  }

  it.effect("answers through SearchItems with the Library Scope's ids", () =>
    Effect.gen(function* () {
      const reads = yield* readsOver(() => seed(perLibraryRows()));
      const { lookup } = yield* lookupOver(reads, [
        library(USER_LIBRARY_ID),
        library(2),
      ]);

      const hits = yield* lookup.search("Alpha", { limit: 5 });

      expect(keys(hits)).toEqual(["LIBRARY2", "LIBRARY3"]);
      expect(hits[0]!.matches).toEqual([[0, 5]]);
      expect(reads.searches.at(-1)).toEqual({
        libraryIDs: [USER_LIBRARY_ID, 2],
        query: "Alpha",
        limit: 5,
      });
    }),
  );

  it.effect(
    "prioritizes and labels cited Items, forwarding them only for empty queries",
    () =>
      Effect.gen(function* () {
        const reads = yield* readsOver(() => seed(perLibraryRows()));
        const { lookup } = yield* lookupOver(reads, [
          library(USER_LIBRARY_ID),
          library(2),
        ]);
        const session = yield* lookup.openSession;
        const cited = ["LIBRARY3g2"];
        const empty = yield* session.search(" ", { cited });
        expect(empty.map((hit) => [hit.item.indexedKey, hit.cited])).toEqual([
          ["LIBRARY3g2", true],
          ["LIBRARY2", false],
        ]);
        expect(reads.searches.at(-1)).toMatchObject({ cited });
        const typed = yield* session.search("Alpha", { cited });
        expect(typed.map((hit) => [hit.item.indexedKey, hit.cited])).toEqual([
          ["LIBRARY2", false],
          ["LIBRARY3g2", true],
        ]);
        expect(reads.searches.at(-1)).not.toHaveProperty("cited");
        expect((yield* session.search("")).every((hit) => !hit.cited)).toBe(
          true,
        );
      }),
  );

  it.effect(
    "searches the Libraries a search names in place of the Library Scope, a session's too",
    () =>
      Effect.gen(function* () {
        const reads = yield* readsOver(() => seed(perLibraryRows()));
        const { lookup } = yield* lookupOver(reads, [
          library(USER_LIBRARY_ID),
          library(2),
        ]);

        const hits = yield* lookup.search("Alpha", { libraries: [library(2)] });
        expect(hits.map((hit) => [hit.item.key, hit.library])).toEqual([
          ["LIBRARY3", null],
        ]);
        expect(reads.searches.at(-1)?.libraryIDs).toEqual([2]);

        const session = yield* lookup.openSession;
        yield* session.search("Alpha", {
          libraries: [library(USER_LIBRARY_ID)],
        });
        expect(reads.searches.at(-1)?.libraryIDs).toEqual([USER_LIBRARY_ID]);
      }),
  );

  it.effect("labels hits only when two Libraries are in scope", () =>
    Effect.gen(function* () {
      const reads = yield* readsOver(() => seed(perLibraryRows()));
      const { lookup, setLibraries } = yield* lookupOver(reads);

      expect((yield* lookup.search("")).map((hit) => hit.library)).toEqual([
        null,
      ]);

      yield* setLibraries([library(USER_LIBRARY_ID), library(2)]);
      expect(
        (yield* lookup.search("")).map((hit) => hit.library?.libraryID),
      ).toEqual([USER_LIBRARY_ID, 2]);
    }),
  );

  it.effect(
    "takes labels from the scope it asked with, so a rename shows at once",
    () =>
      Effect.gen(function* () {
        const reads = yield* readsOver(() => seed(perLibraryRows()));
        const { lookup, setLibraries } = yield* lookupOver(reads, [
          library(USER_LIBRARY_ID),
          library(2),
        ]);
        yield* lookup.search("");

        yield* setLibraries([
          library(USER_LIBRARY_ID),
          { ...library(2), name: "Renamed" },
        ]);
        const hits = yield* lookup.search("");

        expect(hits.map((hit) => hit.library?.name)).toEqual([null, "Renamed"]);
      }),
  );

  it.effect(
    "makes the next search after a scope change cover the new list only",
    () =>
      Effect.gen(function* () {
        const reads = yield* readsOver(() => seed(perLibraryRows()));
        const { lookup, setLibraries } = yield* lookupOver(reads);
        expect((yield* lookup.search(""))[0]?.item.libraryID).toBe(
          USER_LIBRARY_ID,
        );

        yield* setLibraries([library(2)]);
        const hits = yield* lookup.search("");

        expect(hits.map((hit) => hit.item.libraryID)).toEqual([2]);
        expect(reads.searches.at(-1)?.libraryIDs).toEqual([2]);
      }),
  );

  it.effect("answers empty when the database is unavailable", () =>
    Effect.gen(function* () {
      const reads = yield* readsOver(() => null);
      const { lookup } = yield* lookupOver(reads);

      expect(yield* lookup.search("anything")).toEqual([]);
    }),
  );

  it.effect(
    "answers empty without a request while no Library is in scope",
    () =>
      Effect.gen(function* () {
        const reads = yield* readsOver(() => seed(perLibraryRows()));
        const { lookup, setLibraries } = yield* lookupOver(reads, null);

        expect(yield* lookup.search("")).toEqual([]);
        yield* setLibraries([]);
        expect(yield* lookup.search("")).toEqual([]);
        expect(reads.searches).toEqual([]);
      }),
  );

  it.effect("answers empty for a limit of zero", () =>
    Effect.gen(function* () {
      const reads = yield* readsOver(() => seed(perLibraryRows()));
      const { lookup } = yield* lookupOver(reads);
      yield* Queue.take(reads.calls);
      const before = reads.searches.length;

      expect(yield* lookup.search("", { limit: 0 })).toEqual([]);
      expect(reads.searches).toHaveLength(before);
    }),
  );

  it.effect(
    "interrupts the previous request when the next keystroke searches, and answers both with the newest list",
    () =>
      Effect.gen(function* () {
        const reads = yield* readsOver(() => seed(perLibraryRows()));
        const { lookup } = yield* lookupOver(reads, [
          library(USER_LIBRARY_ID),
          library(2),
        ]);
        yield* lookup.search("");
        const session = yield* lookup.openSession;
        const gate = yield* reads.gateSearch;

        const first = yield* Effect.forkChild(session.search("Alpha"));
        yield* gate.entered;
        const second = yield* session.search("LIBRARY3");

        expect(keys(second)).toEqual(["LIBRARY3"]);
        expect(keys(yield* Fiber.join(first))).toEqual(["LIBRARY3"]);
        expect(reads.interrupted).toEqual(["Alpha"]);
      }),
  );

  it.effect(
    "answers a chain of interrupted keystrokes with the newest list",
    () =>
      Effect.gen(function* () {
        const reads = yield* readsOver(() => seed(perLibraryRows()));
        const { lookup } = yield* lookupOver(reads, [
          library(USER_LIBRARY_ID),
          library(2),
        ]);
        yield* lookup.search("");
        const session = yield* lookup.openSession;
        const gates = [yield* reads.gateSearch, yield* reads.gateSearch];

        const first = yield* Effect.forkChild(session.search("A"));
        yield* gates[0]!.entered;
        const second = yield* Effect.forkChild(session.search("Al"));
        yield* gates[1]!.entered;
        const third = yield* session.search("LIBRARY2");

        const answers = [yield* Fiber.join(first), yield* Fiber.join(second)];
        expect([...answers, third].map(keys)).toEqual([
          ["LIBRARY2"],
          ["LIBRARY2"],
          ["LIBRARY2"],
        ]);
        expect(reads.interrupted).toEqual(["A", "Al"]);
      }),
  );

  it.effect("runs two sessions side by side, each answering its own list", () =>
    Effect.gen(function* () {
      const reads = yield* readsOver(() => seed(perLibraryRows()));
      const { lookup } = yield* lookupOver(reads, [
        library(USER_LIBRARY_ID),
        library(2),
      ]);
      yield* lookup.search("");
      const picker = yield* lookup.openSession;
      const suggester = yield* lookup.openSession;
      const gates = [yield* reads.gateSearch, yield* reads.gateSearch];

      const first = yield* Effect.forkChild(picker.search("Alpha"));
      yield* gates[0]!.entered;
      const second = yield* Effect.forkChild(suggester.search("LIBRARY3"));
      yield* gates[1]!.entered;
      for (const gate of gates) yield* gate.open;

      expect(keys(yield* Fiber.join(first))).toEqual(["LIBRARY2", "LIBRARY3"]);
      expect(keys(yield* Fiber.join(second))).toEqual(["LIBRARY3"]);
      expect(reads.interrupted).toEqual([]);
    }),
  );

  it.effect(
    "answers each one-shot search with its own list, beside a session's keystrokes and each other",
    () =>
      Effect.gen(function* () {
        const reads = yield* readsOver(() => seed(perLibraryRows()));
        const { lookup } = yield* lookupOver(reads, [
          library(USER_LIBRARY_ID),
          library(2),
        ]);
        yield* lookup.search("");
        const session = yield* lookup.openSession;
        const gates = [
          yield* reads.gateSearch,
          yield* reads.gateSearch,
          yield* reads.gateSearch,
        ];

        const recent = yield* Effect.forkChild(lookup.search("", { limit: 1 }));
        yield* gates[0]!.entered;
        const other = yield* Effect.forkChild(lookup.search("LIBRARY3"));
        yield* gates[1]!.entered;
        const keystroke = yield* Effect.forkChild(session.search("Alpha"));
        yield* gates[2]!.entered;
        expect(yield* session.search("LIBRARY2")).toHaveLength(1);
        for (const gate of gates) yield* gate.open;

        expect(keys(yield* Fiber.join(recent))).toEqual(["LIBRARY2"]);
        expect(keys(yield* Fiber.join(other))).toEqual(["LIBRARY3"]);
        expect(keys(yield* Fiber.join(keystroke))).toEqual(["LIBRARY2"]);
        expect(reads.interrupted).toEqual(["Alpha"]);
      }),
  );

  it.effect(
    "interrupts a session's pending search on close, and answers it and every later search empty",
    () =>
      Effect.gen(function* () {
        const reads = yield* readsOver(() => seed(perLibraryRows()));
        const { lookup } = yield* lookupOver(reads);
        yield* lookup.search("");
        const sessionScope = yield* Scope.make();
        const session = yield* Scope.provide(lookup.openSession, sessionScope);
        const gate = yield* reads.gateSearch;

        const pending = yield* Effect.forkChild(session.search("Alpha"));
        yield* gate.entered;
        yield* Scope.close(sessionScope, Exit.void);

        expect(yield* Fiber.join(pending)).toEqual([]);
        expect(reads.interrupted).toEqual(["Alpha"]);
        const before = reads.searches.length;
        expect(yield* session.search("Alpha")).toEqual([]);
        expect(reads.searches).toHaveLength(before);
      }),
  );

  it.effect("prewarms with an empty query and a limit of one on start", () =>
    Effect.gen(function* () {
      const reads = yield* readsOver(() => seed(perLibraryRows()));
      yield* lookupOver(reads);

      expect(yield* Queue.take(reads.calls)).toEqual({
        libraryIDs: [USER_LIBRARY_ID],
        query: "",
        uses: {},
        limit: 1,
      });
      expect(reads.searches).toHaveLength(1);
    }),
  );

  it.effect("prewarms the new list on a Library Scope change", () =>
    Effect.gen(function* () {
      const reads = yield* readsOver(() => seed(perLibraryRows()));
      const { setLibraries } = yield* lookupOver(reads);
      yield* Queue.take(reads.calls);

      yield* setLibraries([library(USER_LIBRARY_ID), library(2)]);

      expect(reads.searches.at(-1)).toEqual({
        libraryIDs: [USER_LIBRARY_ID, 2],
        query: "",
        uses: {},
        limit: 1,
      });
    }),
  );

  it.effect(
    "keeps a pending search running through a rename and its prewarm",
    () =>
      Effect.gen(function* () {
        const reads = yield* readsOver(() => seed(perLibraryRows()));
        const { lookup, setLibraries } = yield* lookupOver(reads, [
          library(USER_LIBRARY_ID),
          library(2),
        ]);
        yield* lookup.search("");
        const session = yield* lookup.openSession;
        const gate = yield* reads.gateSearch;

        const search = yield* Effect.forkChild(session.search("Alpha"));
        yield* gate.entered;
        yield* setLibraries([
          library(USER_LIBRARY_ID),
          { ...library(2), name: "Renamed" },
        ]);
        yield* gate.open;

        expect(yield* Fiber.join(search)).toHaveLength(2);
        expect(reads.interrupted).toEqual([]);
      }),
  );

  it.effect(
    "drops a pending search's answer when a database switch gives its local id to another group",
    () =>
      Effect.gen(function* () {
        const reads = yield* readsOver(() => seed(perLibraryRows()));
        const group = (groupID: number): AvailableLibrary => ({
          selector: { type: "group", groupID },
          libraryID: 2,
          name: `Group ${groupID}`,
        });
        const { lookup, setLibraries } = yield* lookupOver(reads, [group(10)]);
        yield* lookup.search("");
        const session = yield* lookup.openSession;
        const gate = yield* reads.gateSearch;

        const search = yield* Effect.forkChild(session.search("Alpha"));
        yield* gate.entered;
        yield* setLibraries([group(20)]);

        expect(yield* Fiber.join(search)).toEqual([]);
        expect(reads.interrupted).toEqual(["Alpha"]);
      }),
  );

  it.effect(
    "drops the pending search of every open session when the scope changes",
    () =>
      Effect.gen(function* () {
        const reads = yield* readsOver(() => seed(perLibraryRows()));
        const { lookup, setLibraries } = yield* lookupOver(reads);
        yield* lookup.search("");
        const picker = yield* lookup.openSession;
        const suggester = yield* lookup.openSession;
        const gates = [yield* reads.gateSearch, yield* reads.gateSearch];

        const pending = [
          yield* Effect.forkChild(picker.search("Alpha")),
          yield* Effect.forkChild(suggester.search("LIBRARY2")),
        ];
        for (const gate of gates) yield* gate.entered;
        yield* setLibraries([library(2)]);

        expect(yield* Fiber.joinAll(pending)).toEqual([[], []]);
        expect(reads.interrupted.toSorted()).toEqual(["Alpha", "LIBRARY2"]);
      }),
  );

  it.effect.each<[string, readonly AvailableLibrary[]]>([
    ["another Library", [library(2)]],
    ["no Library", []],
  ])(
    "drops a pending search's answer when the scope changes to %s",
    ([, libraries]) =>
      Effect.gen(function* () {
        const reads = yield* readsOver(() => seed(perLibraryRows()));
        const { lookup, setLibraries } = yield* lookupOver(reads);
        yield* lookup.search("");
        const gate = yield* reads.gateSearch;

        const search = yield* Effect.forkChild(lookup.search("Alpha"));
        yield* gate.entered;
        yield* setLibraries(libraries);

        expect(yield* Fiber.join(search)).toEqual([]);
        expect(reads.interrupted).toEqual(["Alpha"]);
      }),
  );
});

const lookupOver = Effect.fnUntraced(function* (
  reads: ObservedReads,
  libraries: readonly AvailableLibrary[] | null = [library(USER_LIBRARY_ID)],
  pack?: ResourcePackHostPorts,
) {
  const state = yield* SubscriptionRef.make(scopeState(libraries));
  const notifier = testNotifier();
  const zoteroReads = Layer.succeedContext(
    yield* Layer.build(layerZoteroReads(reads.client)),
  );
  const segmenter = pack
    ? yield* Layer.build(layerDeviceSegmenter(pack, zoteroReads))
    : undefined;
  const context = yield* Layer.build(
    layerTestItemLookup(zoteroReads, layerLibraryScopeOf(state), {
      notifier: notifier.layer,
      ...(segmenter ? { segmenter: Layer.succeedContext(segmenter) } : {}),
    }),
  );
  return {
    notices: () =>
      notifier.notices.map(
        ({ messages }) => (messages[0] as DocumentFragment).textContent,
      ),
    lookup: Context.get(context, ItemLookup),
    segmenter: segmenter && Context.get(segmenter, ChineseSegmenter),
    setLibraries: (next: readonly AvailableLibrary[]) =>
      Effect.gen(function* () {
        yield* SubscriptionRef.set(state, scopeState(next));
        if (next.length === 0) return;
        const libraryIDs = next.map((entry) => entry.libraryID);
        yield* Queue.take(reads.calls).pipe(
          Effect.repeat({
            until: (call) =>
              call.limit === 1 &&
              call.query === "" &&
              isDeepStrictEqual(call.libraryIDs, libraryIDs),
          }),
        );
      }),
  };
});

interface SearchPayload {
  libraryIDs: readonly number[];
  query: string;
  limit: number;
}

interface Gate {
  readonly entered: Effect.Effect<void>;
  readonly open: Effect.Effect<void>;
}

interface ObservedReads {
  readonly client: Effect.Effect<ZoteroReadsClient, never, Scope.Scope>;
  readonly searches: SearchPayload[];
  readonly calls: Queue.Queue<SearchPayload>;
  readonly interrupted: string[];
  readonly gateSearch: Effect.Effect<Gate>;
}

const readsOver = Effect.fnUntraced(function* (
  seedFor: (open: number) => string | null,
  handlers?: Partial<HandlersOptions>,
) {
  const searches: SearchPayload[] = [];
  const interrupted: string[] = [];
  const calls = yield* Queue.unbounded<SearchPayload>();
  const gates: {
    entered: Deferred.Deferred<void>;
    open: Deferred.Deferred<void>;
  }[] = [];

  const wrap = (client: ZoteroReadsClient): ZoteroReadsClient => ({
    ...client,
    SearchItems: ((payload: SearchPayload, options?: object) => {
      searches.push(payload);
      const gate = gates.shift();
      const call = (
        client.SearchItems as (
          payload: SearchPayload,
          options?: object,
        ) => Effect.Effect<unknown, unknown>
      )(payload, options);
      return Queue.offer(calls, payload).pipe(
        Effect.andThen(
          gate
            ? Deferred.succeed(gate.entered, undefined).pipe(
                Effect.andThen(Deferred.await(gate.open)),
              )
            : Effect.void,
        ),
        Effect.andThen(call),
        Effect.onInterrupt(() =>
          Effect.sync(() => interrupted.push(payload.query)),
        ),
      );
    }) as unknown as ZoteroReadsClient["SearchItems"],
  });

  const reads: ObservedReads = {
    client: Effect.map(
      inProcessClient(layerRcRef(memoryOpener(seedFor).open), handlers),
      (client) => wrap(client),
    ),
    searches,
    calls,
    interrupted,
    gateSearch: Effect.gen(function* () {
      const gate = {
        entered: yield* Deferred.make<void>(),
        open: yield* Deferred.make<void>(),
      };
      gates.push(gate);
      return {
        entered: Deferred.await(gate.entered),
        open: Effect.asVoid(Deferred.succeed(gate.open, undefined)),
      };
    }),
  };
  return reads;
});

function perLibraryRows(): {
  key: string;
  itemID: number;
  libraryID: number;
}[] {
  return [USER_LIBRARY_ID, 2].map((libraryID) => ({
    key: `LIBRARY${libraryID + 1}`,
    itemID: libraryID * 100,
    libraryID,
  }));
}

function seed(
  rows: readonly { key: string; itemID: number; libraryID: number }[],
  title = "Alpha",
): string {
  const items = rows
    .map(
      (r) =>
        `(${r.itemID}, 1, '2024-01-01 00:00:00', '2024-01-0${r.libraryID === USER_LIBRARY_ID ? 2 : 1} 00:00:00', ${r.libraryID}, '${r.key}')`,
    )
    .join(", ");
  const data = rows.map((r) => `(${r.itemID}, 10, 1)`).join(", ");
  return `
    insert into libraries (libraryID, type, version, clientVersion)
      values (1, 'user', 1, 0), (2, 'group', 1, 0);
    insert into groups (groupID, libraryID, name) values (2, 2, 'Group 2');
    insert into itemTypes (itemTypeID, typeName) values (1, 'journalArticle');
    insert into fieldsCombined (fieldID, fieldName, custom) values (10, 'title', 0);
    insert into itemDataValues (valueID, value) values (1, '${title}');
    insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key)
      values ${items};
    insert into itemData (itemID, fieldID, valueID) values ${data};
  `;
}

function library(libraryID: number): AvailableLibrary {
  return libraryID === USER_LIBRARY_ID
    ? { selector: { type: "personal" }, libraryID, name: null }
    : {
        selector: { type: "group", groupID: libraryID },
        libraryID,
        name: `Group ${libraryID}`,
      };
}
