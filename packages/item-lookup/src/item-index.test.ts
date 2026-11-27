import { it as effectIt } from "@effect/vitest";
import type { Scope } from "effect";
import {
  Cause,
  Context,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Logger,
  References,
  Scheduler,
} from "effect";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect } from "vitest";

import { USER_LIBRARY_ID } from "@zotlit/db";

import { makeMemoryItemRow as item } from "./fixtures.ts";
import type { IndexSettings, SearchHit } from "./item-index.ts";
import { ItemIndex, layerItemIndex, SourceUnavailable } from "./item-index.ts";
import type { MemoryItemRow, MemoryItemSource } from "./memory-item-source.ts";
import { makeMemoryItemSource } from "./memory-item-source.ts";
import type { MemorySegmenterBinaryReader } from "./memory-segmenter-binary-reader.ts";
import { makeMemorySegmenterBinaryReader } from "./memory-segmenter-binary-reader.ts";
import type { SegmenterBinary, SegmenterStatus } from "./segmenter-switch.ts";

const GROUP_LIBRARY_ID = 2;

const alpha = item({
  key: "ALPHA",
  itemID: 1,
  title: "Alpha transit memo",
  dateModified: "2024-01-01T00:00:00Z",
  lastActivity: 1704067200000,
});
const beta = item({
  key: "BETA",
  itemID: 2,
  title: "Beta transit report",
  dateModified: "2025-01-01T00:00:00Z",
  lastActivity: 1735689600000,
});
const gamma = item({
  key: "GAMMA",
  itemID: 3,
  libraryID: GROUP_LIBRARY_ID,
  title: "Gamma river survey",
  dateModified: "2023-01-01T00:00:00Z",
  lastActivity: 1672531200000,
});

const delta = item({
  key: "DELTA",
  itemID: 4,
  title: "Delta transit notes",
  dateModified: "2026-01-01T00:00:00Z",
  lastActivity: 1767225600000,
});

const epsilon = item({
  key: "EPSILON",
  itemID: 5,
  title: "Epsilon transit atlas",
  dateModified: "2027-01-01T00:00:00Z",
  lastActivity: 1798761600000,
});

const fillers = Array.from({ length: 600 }, (_, index) =>
  item({
    key: `FILLER${String(index).padStart(3, "0")}`,
    itemID: 100 + index,
    title: `Filler ${index}`,
    dateModified: "2020-01-01T00:00:00Z",
  }),
);

const chinese = item({
  key: "CHINA",
  itemID: 9,
  title: "长江流域的城市化研究",
  dateModified: "2022-01-01T00:00:00Z",
  lastActivity: 1640995200000,
});
const JIEBA_ONLY = "流域";
const WHOLE_RUN = "长江流域";
const JIEBA_WASM = readFileSync(
  fileURLToPath(
    new URL("jieba_rs_wasm_bg.wasm", import.meta.resolve("jieba-wasm/web")),
  ),
);
const PACK = "app://vault/plugins/zotlit-resources/main.js";
const INSTALLED: SegmenterBinary = {
  url: PACK,
  entry: "chinese-segmenter",
  version: "1.0.0",
};
const UPDATED: SegmenterBinary = { ...INSTALLED, version: "1.1.0" };
const MISSING: SegmenterBinary = { ...INSTALLED, version: "0.9.0" };
const CORRUPT: SegmenterBinary = { ...INSTALLED, version: "1.0.1" };
const storedBytes = (binary: SegmenterBinary): BufferSource | undefined =>
  binary.version === INSTALLED.version || binary.version === UPDATED.version
    ? JIEBA_WASM
    : binary.version === CORRUPT.version
      ? new Uint8Array([0, 1, 2, 3])
      : undefined;

const USER = [USER_LIBRARY_ID] as const;
const GROUP = [GROUP_LIBRARY_ID] as const;

interface Harness {
  source: MemoryItemSource;
  reader: MemorySegmenterBinaryReader;
  search: (
    libraries: readonly number[],
    query: string,
  ) => Effect.Effect<string[], unknown>;
  hits: (
    libraries: readonly number[],
    query: string,
  ) => Effect.Effect<readonly SearchHit[], SourceUnavailable>;
  configure: (settings: IndexSettings) => Effect.Effect<void>;
  checkSegmenter: (
    binary: SegmenterBinary | null,
  ) => Effect.Effect<SegmenterStatus>;
}

interface Setup {
  rows?: ReadonlyMap<number, readonly MemoryItemRow[]>;
  maxOpsBeforeYield?: number;
  initial?: IndexSettings;
  bytesFor?: (binary: SegmenterBinary) => BufferSource | undefined;
}

function withIndex<A>(
  body: (harness: Harness) => Effect.Effect<A, unknown, Scope.Scope>,
  setup: Setup = {},
): Effect.Effect<A, unknown> {
  const { maxOpsBeforeYield } = setup;
  return Effect.gen(function* () {
    const source = yield* makeMemoryItemSource(
      setup.rows ??
        new Map([
          [USER_LIBRARY_ID, [alpha, beta]],
          [GROUP_LIBRARY_ID, [gamma]],
        ]),
    );
    const reader = yield* makeMemorySegmenterBinaryReader(
      setup.bytesFor ?? storedBytes,
    );
    const context = yield* Layer.build(
      layerItemIndex(
        setup.initial ?? { locale: "en", segmenterBinary: null },
      ).pipe(Layer.provide([source.layer, reader.layer])),
    );
    const { search, configure, checkSegmenter } = Context.get(
      context,
      ItemIndex,
    );
    return yield* body({
      source,
      reader,
      search: (libraries, query) =>
        search(libraries, query, { limit: 50 }).pipe(
          Effect.map((hits) => hits.map((hit) => hit.item.indexedKey)),
        ),
      hits: (libraries, query) => search(libraries, query, { limit: 50 }),
      configure,
      checkSegmenter,
    });
  }).pipe(Effect.scoped, (program) =>
    maxOpsBeforeYield === undefined
      ? program
      : Effect.provideService(
          program,
          Scheduler.MaxOpsBeforeYield,
          maxOpsBeforeYield,
        ),
  );
}

function builtLogs() {
  const waiters: Deferred.Deferred<Readonly<Record<string, unknown>>>[] = [];
  const logger = Logger.make(({ message, fiber }) => {
    const text = Array.isArray(message) ? message.join(" ") : String(message);
    if (text !== "Item index built") return;
    const annotations = fiber.getRef(References.CurrentLogAnnotations);
    for (const waiter of waiters.splice(0))
      Deferred.doneUnsafe(waiter, Exit.succeed(annotations));
  });
  return {
    layer: Logger.layer([logger]),
    next: Effect.sync(() => {
      const waiter = Deferred.makeUnsafe<Readonly<Record<string, unknown>>>();
      waiters.push(waiter);
      return waiter;
    }),
  };
}

describe("Item Index", () => {
  effectIt.effect("runs no build before the first search", () =>
    Effect.gen(function* () {
      const reads = yield* withIndex(({ source }) =>
        Effect.gen(function* () {
          yield* source.notify;
          yield* Effect.yieldNow;
          return { ...source.reads };
        }),
      );

      expect(reads).toEqual({
        pinned: 0,
        scans: 0,
        items: 0,
        signature: 0,
        itemsByIndexedKey: 0,
        interrupted: 0,
        released: 0,
      });
    }),
  );

  effectIt.effect(
    "builds once for the first search and reuses the index after",
    () =>
      Effect.gen(function* () {
        const result = yield* withIndex(({ source, search }) =>
          Effect.gen(function* () {
            const first = yield* search(USER, "");
            const second = yield* search(USER, "transit");
            return { first, second, scans: source.reads.scans };
          }),
        );

        expect(result.first).toEqual(["BETA", "ALPHA"]);
        expect(result.second).toEqual(
          expect.arrayContaining(["ALPHA", "BETA"]),
        );
        expect(result.scans).toBe(1);
      }),
  );

  effectIt.effect("shares one build between parallel first searches", () =>
    Effect.gen(function* () {
      const result = yield* withIndex(({ source, search }) =>
        Effect.gen(function* () {
          const answers = yield* Effect.all(
            [search(USER, ""), search(USER, "")],
            {
              concurrency: "unbounded",
            },
          ).pipe(Effect.provideService(Scheduler.MaxOpsBeforeYield, 4));
          return { answers, scans: source.reads.scans };
        }),
      );

      expect(result.answers).toEqual([
        ["BETA", "ALPHA"],
        ["BETA", "ALPHA"],
      ]);
      expect(result.scans).toBe(1);
    }),
  );

  effectIt.effect(
    "answers from the old index while a new generation rebuilds",
    () =>
      Effect.gen(function* () {
        const result = yield* withIndex(({ source, search }) =>
          Effect.gen(function* () {
            yield* search(USER, "");
            yield* source.setItems(USER_LIBRARY_ID, [alpha, beta, delta]);
            yield* source.closeGate;
            yield* source.swap;
            yield* source.held;
            const during = yield* search(USER, "");
            yield* source.openGate;
            const after = yield* until(
              search(USER, ""),
              (keys) => keys.length === 3,
            );
            return { during, after, scans: source.reads.scans };
          }),
        );

        expect(result.during).toEqual(["BETA", "ALPHA"]);
        expect(result.after).toEqual(["DELTA", "BETA", "ALPHA"]);
        expect(result.scans).toBe(2);
      }),
  );

  effectIt.effect(
    "starts a build again when the source commits between two pages, and first holds the new version",
    () => {
      const logs = builtLogs();
      return withIndex(({ source, search }) =>
        Effect.gen(function* () {
          yield* search(USER, "");
          yield* source.setItems(USER_LIBRARY_ID, [
            alpha,
            beta,
            delta,
            ...fillers,
          ]);
          yield* source.closeGateAfter(1);
          yield* source.notify;
          yield* source.held;
          yield* source.commit(USER_LIBRARY_ID, [alpha, epsilon, ...fillers]);
          const during = yield* search(USER, "transit").pipe(
            Effect.forkChild({ startImmediately: true }),
          );
          const built = yield* logs.next;
          yield* source.openGate;
          expect(yield* Deferred.await(built)).toMatchObject({
            count: fillers.length + 2,
          });
          const answered = yield* Fiber.join(during);
          expect(answered).toHaveLength(2);
          expect(answered).toEqual(
            expect.arrayContaining(["EPSILON", "ALPHA"]),
          );
          const after = yield* search(USER, "transit");
          expect(after).toHaveLength(2);
          expect(after).toEqual(expect.arrayContaining(["EPSILON", "ALPHA"]));
        }),
      ).pipe(
        Effect.provide(logs.layer),
        Effect.provideService(References.MinimumLogLevel, "All"),
      );
    },
  );

  effectIt.effect(
    "starts a build again when the source commits after the last page, and first holds the new version",
    () => {
      const logs = builtLogs();
      return withIndex(({ source, search }) =>
        Effect.gen(function* () {
          yield* search(USER, "");
          yield* source.closePublishGate;
          yield* source.setItems(USER_LIBRARY_ID, [alpha, beta, delta]);
          yield* source.notify;
          yield* source.publishHeld;
          yield* source.commit(USER_LIBRARY_ID, [alpha, epsilon]);
          const built = yield* logs.next;
          yield* source.openPublishGate;
          expect(yield* Deferred.await(built)).toMatchObject({ count: 2 });
          expect(yield* search(USER, "")).toEqual(["EPSILON", "ALPHA"]);
        }),
      ).pipe(
        Effect.provide(logs.layer),
        Effect.provideService(References.MinimumLogLevel, "All"),
      );
    },
  );

  effectIt.effect(
    "answers a search that matched before a commit from the index of the commit, so a renamed Item never matches its old title with its new record",
    () =>
      withIndex(({ source, hits }) =>
        Effect.gen(function* () {
          yield* hits(USER, "");
          yield* source.closePublishGate;
          yield* source.commit(USER_LIBRARY_ID, [
            item({
              key: "ALPHA",
              itemID: 1,
              title: "Alpha river memo",
              dateModified: "2028-01-01T00:00:00Z",
              lastActivity: 1830297600000,
            }),
            beta,
          ]);
          yield* source.publishHeld;
          const during = yield* hits(USER, "transit").pipe(
            Effect.forkChild({ startImmediately: true }),
          );
          yield* source.openPublishGate;
          const answered = yield* Fiber.join(during);
          expect(answered.map((hit) => titleOf(hit))).toEqual([
            "Beta transit report",
          ]);
        }),
      ),
  );

  effectIt.effect("rebuilds on a moved signature", () =>
    Effect.gen(function* () {
      const result = yield* withIndex(({ source, search }) =>
        Effect.gen(function* () {
          yield* search(USER, "");
          yield* source.setItems(USER_LIBRARY_ID, [alpha, beta, delta]);
          yield* source.notify;
          const after = yield* until(
            search(USER, ""),
            (keys) => keys.length === 3,
          );
          return { after, scans: source.reads.scans };
        }),
      );

      expect(result.after).toEqual(["DELTA", "BETA", "ALPHA"]);
      expect(result.scans).toBe(2);
    }),
  );

  effectIt.effect("rebuilds on a swapped source with equal signatures", () =>
    Effect.gen(function* () {
      const scans = yield* withIndex(({ source, search }) =>
        Effect.gen(function* () {
          yield* search(USER, "");
          yield* source.swap;
          yield* eventually(() => source.reads.released === 1);
          return source.reads.scans;
        }),
      );

      expect(scans).toBe(2);
    }),
  );

  effectIt.effect(
    "keeps the index on an equal signature and an unchanged generation",
    () =>
      Effect.gen(function* () {
        const reads = yield* withIndex(({ source, search }) =>
          Effect.gen(function* () {
            yield* search(USER, "");
            yield* source.notify;
            yield* eventually(() => source.reads.released === 1);
            yield* search(USER, "");
            return { ...source.reads };
          }),
        );

        expect(reads.signature).toBe(2);
        expect(reads.scans).toBe(1);
      }),
  );

  effectIt.effect(
    "evicts an abandoned list at the next emission and interrupts its build",
    () =>
      Effect.gen(function* () {
        const result = yield* withIndex(({ source, search }) =>
          Effect.gen(function* () {
            yield* source.closeGate;
            const abandoned = yield* Effect.forkChild(search(USER, ""));
            yield* source.held;
            yield* Fiber.interrupt(abandoned);
            yield* source.notify;
            const group = yield* Effect.forkChild(search(GROUP, ""));
            yield* eventually(() => source.waiting === 2);
            yield* source.notify;
            yield* eventually(() => source.reads.interrupted === 1);
            yield* source.openGate;
            const answer = yield* Fiber.join(group);
            const scansBefore = source.reads.scans;
            yield* search(USER, "");
            return {
              answer,
              interrupted: source.reads.interrupted,
              rebuiltUser: source.reads.scans - scansBefore,
            };
          }),
        );

        expect(result.answer).toEqual(["GAMMA"]);
        expect(result.interrupted).toBe(1);
        expect(result.rebuiltUser).toBe(1);
      }),
  );

  effectIt.effect(
    "runs exactly two builds for two emissions during a gated build",
    () =>
      Effect.gen(function* () {
        const result = yield* withIndex(({ source, search }) =>
          Effect.gen(function* () {
            yield* source.closeGate;
            const first = yield* Effect.forkChild(search(USER, ""));
            yield* source.held;
            yield* source.setItems(USER_LIBRARY_ID, [alpha, beta, delta]);
            yield* source.swap;
            yield* source.swap;
            yield* source.openGate;
            const answer = yield* Fiber.join(first);
            return {
              answer,
              scans: source.reads.scans,
              interrupted: source.reads.interrupted,
            };
          }),
        );

        expect(result.answer).toEqual(["DELTA", "BETA", "ALPHA"]);
        expect(result.scans).toBe(2);
        expect(result.interrupted).toBe(0);
      }),
  );

  effectIt.effect(
    "runs the trailing rebuild for changes that land as a build ends",
    () =>
      Effect.gen(function* () {
        const epsilon = item({
          key: "EPSILON",
          itemID: 5,
          title: "Epsilon transit atlas",
          dateModified: "2027-01-01T00:00:00Z",
          lastActivity: 1798761600000,
        });
        const answer = yield* withIndex(
          ({ source, search }) =>
            Effect.gen(function* () {
              yield* search(USER, "");
              yield* source.onNextRelease(
                Effect.andThen(
                  source.setItems(USER_LIBRARY_ID, [
                    alpha,
                    beta,
                    delta,
                    epsilon,
                  ]),
                  source.swap,
                ),
              );
              yield* source.setItems(USER_LIBRARY_ID, [alpha, beta, delta]);
              yield* source.swap;
              return yield* until(
                search(USER, ""),
                (keys) => keys.length === 4,
              );
            }),
          { maxOpsBeforeYield: 4 },
        );

        expect(answer).toEqual(["EPSILON", "DELTA", "BETA", "ALPHA"]);
      }),
  );

  effectIt.effect(
    "keeps the build running when its first waiter is interrupted",
    () =>
      Effect.gen(function* () {
        const result = yield* withIndex(({ source, search }) =>
          Effect.gen(function* () {
            yield* source.closeGate;
            const waiter = yield* Effect.forkChild(search(USER, ""));
            yield* source.held;
            yield* Fiber.interrupt(waiter);
            yield* source.openGate;
            const answer = yield* search(USER, "");
            return {
              answer,
              scans: source.reads.scans,
              interrupted: source.reads.interrupted,
            };
          }),
        );

        expect(result.answer).toEqual(["BETA", "ALPHA"]);
        expect(result.scans).toBe(1);
        expect(result.interrupted).toBe(0);
      }),
  );

  effectIt.effect("answers a search while another list builds", () =>
    Effect.gen(function* () {
      const result = yield* withIndex(({ source, search }) =>
        Effect.gen(function* () {
          yield* search(USER, "");
          yield* source.closeGate;
          const group = yield* Effect.forkChild(search(GROUP, ""));
          yield* source.held;
          const user = yield* search(USER, "");
          const groupDone = group.pollUnsafe() !== undefined;
          yield* source.openGate;
          return { user, groupDone, group: yield* Fiber.join(group) };
        }),
      );

      expect(result.user).toEqual(["BETA", "ALPHA"]);
      expect(result.groupDone).toBe(false);
      expect(result.group).toEqual(["GAMMA"]);
    }),
  );

  effectIt.effect("rebuilds every held list on a locale change", () =>
    Effect.gen(function* () {
      const scans = yield* withIndex(({ source, search, configure }) =>
        Effect.gen(function* () {
          yield* search(USER, "");
          yield* search(GROUP, "");
          yield* configure({ locale: "zh", segmenterBinary: null });
          yield* eventually(() => source.reads.released === 2);
          return source.reads.scans;
        }),
      );

      expect(scans).toBe(4);
    }),
  );

  effectIt.effect(
    "hydrates the hits on the source the answering index holds, the old one while a rebuild waits",
    () =>
      Effect.gen(function* () {
        const renamed = item({
          key: "BETA",
          itemID: 2,
          title: "Beta transit summary",
          dateModified: "2025-01-01T00:00:00Z",
          lastActivity: 1735689600000,
        });
        const result = yield* withIndex(({ source, hits }) =>
          Effect.gen(function* () {
            const first = yield* hits(USER, "transit");
            yield* source.setItems(USER_LIBRARY_ID, [alpha, renamed, delta]);
            yield* source.closeGate;
            yield* source.swap;
            yield* source.held;
            const during = yield* hits(USER, "transit");
            yield* source.openGate;
            const after = yield* until(
              hits(USER, "transit"),
              (answer) => answer.length === 3,
            );
            return { first, during, after };
          }),
        );

        expect(titlesOf(result.first)).toEqual({
          BETA: "Beta transit report",
          ALPHA: "Alpha transit memo",
        });
        expect(result.during).toEqual(result.first);
        expect(titlesOf(result.after)).toEqual({
          DELTA: "Delta transit notes",
          BETA: "Beta transit summary",
          ALPHA: "Alpha transit memo",
        });
        for (const hit of [...result.first, ...result.after]) {
          const title = titleOf(hit) ?? "";
          expect(
            hit.matches.map(([start, end]) => title.slice(start, end)),
          ).toEqual(["transit"]);
        }
      }),
  );

  effectIt.effect(
    "drops a hit whose Item vanished from the source the index holds",
    () =>
      Effect.gen(function* () {
        const result = yield* withIndex(({ source, search }) =>
          Effect.gen(function* () {
            const before = yield* search(USER, "");
            yield* source.vanish("ALPHA");
            const after = yield* search(USER, "");
            return { before, after, scans: source.reads.scans };
          }),
        );

        expect(result.before).toEqual(["BETA", "ALPHA"]);
        expect(result.after).toEqual(["BETA"]);
        expect(result.scans).toBe(1);
      }),
  );

  effectIt.effect(
    "holds an index's source until a newer index replaces it and no search holds it",
    () =>
      Effect.gen(function* () {
        const result = yield* withIndex(({ source, search }) =>
          Effect.gen(function* () {
            yield* search(USER, "");
            const built = source.reads.released;
            yield* source.closeHydrationGate;
            const held = yield* Effect.forkChild(search(USER, ""));
            yield* source.hydrationHeld;
            yield* source.setItems(USER_LIBRARY_ID, [alpha, beta, delta]);
            yield* source.swap;
            yield* until(search(USER, ""), (keys) => keys.length === 3);
            const replaced = source.reads.released;
            yield* source.openHydrationGate;
            const answer = yield* Fiber.join(held);
            return { built, replaced, answer, closed: source.reads.released };
          }),
        );

        expect(result).toEqual({
          built: 0,
          replaced: 0,
          answer: ["BETA", "ALPHA"],
          closed: 1,
        });
      }),
  );

  effectIt.effect("releases the source of a list evicted at an emission", () =>
    Effect.gen(function* () {
      const released = yield* withIndex(({ source, search }) =>
        Effect.gen(function* () {
          yield* search(USER, "");
          yield* search(GROUP, "");
          yield* source.notify;
          yield* eventually(() => source.reads.released === 2);
          yield* source.notify;
          yield* eventually(() => source.reads.released === 4);
          return source.reads.released;
        }),
      );

      expect(released).toBe(4);
    }),
  );

  effectIt.effect(
    "keeps the latest list warm across emissions with no search between",
    () =>
      Effect.gen(function* () {
        const result = yield* withIndex(({ source, search }) =>
          Effect.gen(function* () {
            yield* search(USER, "");
            yield* search(GROUP, "");
            yield* source.notify;
            yield* eventually(() => source.reads.released === 2);
            yield* source.notify;
            yield* eventually(() => source.reads.released === 4);
            yield* source.notify;
            yield* eventually(() => source.reads.released === 5);
            const before = source.reads.scans;
            const group = yield* search(GROUP, "");
            const groupBuilds = source.reads.scans - before;
            const user = yield* search(USER, "");
            return {
              group,
              groupBuilds,
              user,
              userBuilds: source.reads.scans - before - groupBuilds,
            };
          }),
        );

        expect(result).toEqual({
          group: ["GAMMA"],
          groupBuilds: 0,
          user: ["BETA", "ALPHA"],
          userBuilds: 1,
        });
      }),
  );

  effectIt.effect(
    "fails the search and drops the index when the source is unavailable",
    () =>
      Effect.gen(function* () {
        const result = yield* withIndex(({ source, search }) =>
          Effect.gen(function* () {
            yield* search(USER, "");
            yield* source.setUnavailable(true);
            yield* source.notify;
            const exit = yield* until(
              Effect.exit(search(USER, "")),
              Exit.isFailure,
            );
            const failure = Exit.isFailure(exit)
              ? Cause.squash(exit.cause)
              : null;
            yield* source.setUnavailable(false);
            const answer = yield* search(USER, "");
            return { failure, answer, scans: source.reads.scans };
          }),
        );

        expect(result.failure).toBeInstanceOf(SourceUnavailable);
        expect(result.answer).toEqual(["BETA", "ALPHA"]);
        expect(result.scans).toBe(2);
      }),
  );
});

describe("Item Index with the Chinese Segmenter", () => {
  const rows: Setup = {
    rows: new Map([
      [USER_LIBRARY_ID, [chinese, alpha]],
      [GROUP_LIBRARY_ID, [gamma]],
    ]),
  };
  const EVERYTHING = [USER_LIBRARY_ID, GROUP_LIBRARY_ID] as const;
  const installed: Setup = {
    ...rows,
    initial: { locale: "en", segmenterBinary: INSTALLED },
  };

  effectIt.effect(
    "cuts Chinese titles and queries with jieba from an installed binary at start",
    () =>
      Effect.gen(function* () {
        const result = yield* withIndex(
          ({ reader, search }) =>
            Effect.gen(function* () {
              const hits = yield* search(USER, JIEBA_ONLY);
              return { hits, asked: [...reader.asked] };
            }),
          installed,
        );

        expect(result).toEqual({ hits: ["CHINA"], asked: [INSTALLED] });
      }),
  );

  effectIt.effect(
    "segments CJK runs through Intl.Segmenter with no binary",
    () =>
      Effect.gen(function* () {
        const result = yield* withIndex(
          ({ reader, search }) =>
            Effect.gen(function* () {
              const part = yield* search(USER, JIEBA_ONLY);
              const whole = yield* search(USER, WHOLE_RUN);
              return { part, whole, asked: reader.asked.length };
            }),
          rows,
        );

        expect(result).toEqual({ part: [], whole: ["CHINA"], asked: 0 });
      }),
  );

  effectIt.effect(
    "rebuilds every held list once on a configure that installs the binary",
    () =>
      Effect.gen(function* () {
        const result = yield* withIndex(
          ({ source, search, configure }) =>
            Effect.gen(function* () {
              const before = yield* search(USER, JIEBA_ONLY);
              yield* search(EVERYTHING, "");
              yield* configure({ locale: "en", segmenterBinary: INSTALLED });
              const after = yield* until(
                search(USER, JIEBA_ONLY),
                (keys) => keys.length > 0,
              );
              yield* eventually(() => source.reads.scans >= 6);
              yield* search(EVERYTHING, "");
              return { before, after, scans: source.reads.scans };
            }),
          rows,
        );

        expect(result.before).toEqual([]);
        expect(result.after).toEqual(["CHINA"]);
        expect(result.scans).toBe(6);
      }),
  );

  effectIt.effect(
    "rebuilds every held list once on a configure that changes the locale and installs the binary",
    () =>
      Effect.gen(function* () {
        const scans = yield* withIndex(
          ({ source, search, configure }) =>
            Effect.gen(function* () {
              yield* search(USER, JIEBA_ONLY);
              yield* search(EVERYTHING, JIEBA_ONLY);
              yield* configure({ locale: "zh", segmenterBinary: INSTALLED });
              for (const libraries of [USER, EVERYTHING]) {
                yield* until(
                  search(libraries, JIEBA_ONLY),
                  (keys) => keys.length > 0,
                );
              }
              return source.reads.scans;
            }),
          rows,
        );

        expect(scans).toBe(6);
      }),
  );

  effectIt.effect(
    "falls back to Intl.Segmenter and still answers on a configure that uninstalls the binary",
    () =>
      Effect.gen(function* () {
        const result = yield* withIndex(
          ({ search, configure }) =>
            Effect.gen(function* () {
              const before = yield* search(USER, JIEBA_ONLY);
              yield* configure({ locale: "en", segmenterBinary: null });
              const part = yield* until(
                search(USER, JIEBA_ONLY),
                (keys) => keys.length === 0,
              );
              const whole = yield* search(USER, WHOLE_RUN);
              return { before, part, whole };
            }),
          installed,
        );

        expect(result).toEqual({
          before: ["CHINA"],
          part: [],
          whole: ["CHINA"],
        });
      }),
  );

  effectIt.effect.each([
    ["missing", MISSING],
    ["corrupt", CORRUPT],
  ] as const)(
    "keeps search answering on Intl.Segmenter with a %s binary at start",
    ([, binary]) =>
      Effect.gen(function* () {
        const result = yield* withIndex(
          ({ search }) =>
            Effect.gen(function* () {
              const part = yield* search(USER, JIEBA_ONLY);
              const whole = yield* search(USER, WHOLE_RUN);
              return { part, whole };
            }),
          { ...rows, initial: { locale: "en", segmenterBinary: binary } },
        );

        expect(result).toEqual({ part: [], whole: ["CHINA"] });
      }),
  );

  effectIt.effect(
    "keeps search answering on Intl.Segmenter after a configure with a corrupt binary",
    () =>
      Effect.gen(function* () {
        const result = yield* withIndex(
          ({ source, search, configure }) =>
            Effect.gen(function* () {
              yield* search(USER, WHOLE_RUN);
              yield* configure({ locale: "en", segmenterBinary: CORRUPT });
              const whole = yield* search(USER, WHOLE_RUN);
              return { whole, scans: source.reads.scans };
            }),
          rows,
        );

        expect(result).toEqual({ whole: ["CHINA"], scans: 1 });
      }),
  );

  effectIt.effect(
    "tries the same binary again on a configure after a failed load",
    () =>
      Effect.gen(function* () {
        let reads = 0;
        const result = yield* withIndex(
          ({ search, configure }) =>
            Effect.gen(function* () {
              const failed = yield* search(USER, JIEBA_ONLY);
              yield* configure({ locale: "en", segmenterBinary: INSTALLED });
              const retried = yield* until(
                search(USER, JIEBA_ONLY),
                (keys) => keys.length > 0,
              );
              return { failed, retried };
            }),
          {
            ...installed,
            bytesFor: () => {
              reads++;
              return reads === 1 ? undefined : JIEBA_WASM;
            },
          },
        );

        expect(reads).toBe(2);
        expect(result).toEqual({ failed: [], retried: ["CHINA"] });
      }),
  );

  effectIt.effect(
    "applies an uninstall racing an install in arrival order",
    () =>
      Effect.gen(function* () {
        const result = yield* withIndex(
          ({ reader, search, configure }) =>
            Effect.gen(function* () {
              yield* reader.closeGate;
              const install = yield* Effect.forkChild(
                configure({ locale: "en", segmenterBinary: INSTALLED }),
              );
              yield* reader.held;
              const uninstall = yield* Effect.forkChild(
                configure({ locale: "en", segmenterBinary: null }),
              );
              yield* Effect.yieldNow;
              const waited = uninstall.pollUnsafe() === undefined;
              yield* reader.openGate;
              yield* Fiber.join(install);
              yield* Fiber.join(uninstall);
              return { waited, hits: yield* search(USER, JIEBA_ONLY) };
            }),
          rows,
        );

        expect(result).toEqual({ waited: true, hits: [] });
      }),
  );

  effectIt.effect.each([
    ["no binary", null, null],
    ["the installed binary", INSTALLED, INSTALLED],
  ] as const)(
    "rebuilds nothing on a configure with equal settings and %s",
    ([, binary, next]) =>
      Effect.gen(function* () {
        const result = yield* withIndex(
          ({ source, reader, search, configure }) =>
            Effect.gen(function* () {
              yield* search(USER, "");
              yield* configure({ locale: "en", segmenterBinary: next });
              yield* source.notify;
              yield* eventually(() => source.reads.released === 1);
              yield* search(USER, "");
              return {
                scans: source.reads.scans,
                asked: reader.asked.length,
              };
            }),
          { ...rows, initial: { locale: "en", segmenterBinary: binary } },
        );

        expect(result).toEqual({ scans: 1, asked: binary ? 1 : 0 });
      }),
  );

  effectIt.effect(
    "states the Segmenter ready after a read of the binary it cuts with, and rebuilds nothing",
    () =>
      Effect.gen(function* () {
        const result = yield* withIndex(
          ({ source, reader, search, checkSegmenter }) =>
            Effect.gen(function* () {
              yield* search(USER, JIEBA_ONLY);
              const status = yield* checkSegmenter(INSTALLED);
              yield* source.notify;
              yield* eventually(() => source.reads.released === 1);
              const hits = yield* search(USER, JIEBA_ONLY);
              return {
                status,
                hits,
                scans: source.reads.scans,
                asked: reader.asked.length,
              };
            }),
          installed,
        );

        expect(result).toEqual({
          status: { kind: "ready", version: "1.0.0" },
          hits: ["CHINA"],
          scans: 1,
          asked: 2,
        });
      }),
  );

  effectIt.effect(
    "states the version of the pack whose binary runs, after an update of the pack",
    () =>
      Effect.gen(function* () {
        const result = yield* withIndex(
          ({ configure, checkSegmenter }) =>
            Effect.gen(function* () {
              const checked = yield* checkSegmenter(UPDATED);
              yield* configure({ locale: "en", segmenterBinary: null });
              return { checked, again: yield* checkSegmenter(UPDATED) };
            }),
          installed,
        );

        const running = { kind: "ready", version: INSTALLED.version };
        expect(result).toEqual({ checked: running, again: running });
      }),
  );

  effectIt.effect.each([
    ["missing", MISSING, { kind: "pack-outdated" }],
    ["corrupt", CORRUPT, { kind: "failed", detail: expect.any(String) }],
  ] as const)(
    "states why the Segmenter does not cut with a %s binary",
    ([, binary, expected]) =>
      Effect.gen(function* () {
        const status = yield* withIndex(
          ({ checkSegmenter }) => checkSegmenter(binary),
          { ...rows, initial: { locale: "en", segmenterBinary: binary } },
        );

        expect(status).toEqual(expected);
      }),
  );

  effectIt.effect(
    "starts the binary at a check after a failed load, and states it ready",
    () =>
      Effect.gen(function* () {
        let reads = 0;
        const result = yield* withIndex(
          ({ search, checkSegmenter }) =>
            Effect.gen(function* () {
              const failed = yield* search(USER, JIEBA_ONLY);
              const status = yield* checkSegmenter(INSTALLED);
              const retried = yield* until(
                search(USER, JIEBA_ONLY),
                (keys) => keys.length > 0,
              );
              return { failed, status, retried };
            }),
          {
            ...installed,
            bytesFor: () => {
              reads++;
              return reads === 1 ? undefined : JIEBA_WASM;
            },
          },
        );

        expect(result).toEqual({
          failed: [],
          status: { kind: "ready", version: "1.0.0" },
          retried: ["CHINA"],
        });
      }),
  );

  effectIt.effect(
    "leaves jieba at a check that finds the pack without the binary",
    () =>
      Effect.gen(function* () {
        let reads = 0;
        const result = yield* withIndex(
          ({ search, checkSegmenter }) =>
            Effect.gen(function* () {
              const before = yield* search(USER, JIEBA_ONLY);
              const status = yield* checkSegmenter(INSTALLED);
              const after = yield* until(
                search(USER, JIEBA_ONLY),
                (keys) => keys.length === 0,
              );
              return { before, status, after };
            }),
          {
            ...installed,
            bytesFor: () => {
              reads++;
              return reads === 1 ? JIEBA_WASM : undefined;
            },
          },
        );

        expect(result).toEqual({
          before: ["CHINA"],
          status: { kind: "pack-outdated" },
          after: [],
        });
      }),
  );
});

function titlesOf(hits: readonly SearchHit[]): Record<string, string | null> {
  return Object.fromEntries(
    hits.map((hit) => [hit.item.indexedKey, titleOf(hit)]),
  );
}

function titleOf({ item }: SearchHit): string | null {
  return "title" in item.fields ? (item.fields.title ?? null) : null;
}

function eventually(check: () => boolean): Effect.Effect<void> {
  return until(Effect.void, () => check()).pipe(Effect.asVoid);
}

function until<A, E>(
  probe: Effect.Effect<A, E>,
  check: (answer: A) => boolean,
): Effect.Effect<A, E> {
  return Effect.gen(function* () {
    for (let attempt = 0; attempt < 200; attempt++) {
      const answer = yield* probe;
      if (check(answer)) return answer;
      yield* Effect.yieldNow;
    }
    return yield* Effect.die(new Error("condition never held"));
  });
}
