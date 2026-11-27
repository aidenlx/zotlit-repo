import { it } from "@effect/vitest";
import { Context, Effect, Exit, Layer, Scope } from "effect";
import { describe, expect } from "vitest";

import type { ZoteroDatabase } from "@zotlit/db";
import { openWasmClient } from "@zotlit/db/client/wasm";
import { stagingViolations } from "@zotlit/db/replica/staging-invariants";
import type { StagingCheckOptions } from "@zotlit/db/replica/staging-invariants";
import type { FakeRequest } from "@zotlit/web-library/fake-zotero-api";
import { READ_ALL_ACCESS } from "@zotlit/web-library/fake-zotero-api/scenario";

import { Connection } from "./connection.ts";
import { WebLibrarySync } from "./web-api-source.ts";

import { SEED } from "#__fixtures__/reads-seed.ts";
import {
  keptEngine,
  loadMemoryEngine,
  memoryWebApiSource,
  seededApi,
  webApiConfig,
} from "#__fixtures__/web-api.ts";
import { REPLICA_FILE } from "#contract/web-worker.ts";

const ACCOUNT = { userID: 42, username: "reader" } as const;
const OTHER_KEY = "otheraccountkey00000000c";
const NO_ACCESS_KEY = "noaccesskey0000000000000";
const DATES: Record<string, string> = {
  "en-US": "2020-01-02 01/02/2020",
  "en-GB": "2020-02-01 01/02/2020",
};
const other = (locale: string) => (locale === "en-US" ? "en-GB" : "en-US");

const storedDate = (client: ZoteroDatabase) =>
  client.get<{ value: string }>(
    `select v.value from items i
      join itemData d on d.itemID = i.itemID
      join fieldsCombined f on f.fieldID = d.fieldID
      join itemDataValues v on v.valueID = d.valueID
      where i.key = 'MAIN2345' and f.fieldName = 'date'`,
  )?.value;

const until = (predicate: () => boolean, what: string) =>
  Effect.gen(function* () {
    for (let i = 0; i < 400; i++) {
      if (predicate()) return;
      yield* Effect.promise(
        () => new Promise((resolve) => setTimeout(resolve, 5)),
      );
    }
    return yield* Effect.die(`${what} did not happen`);
  });

const SEQUENCES = ["first build", "language rebuild"] as const;
type Sequence = (typeof SEQUENCES)[number];

type Step =
  | { readonly kind: "request"; readonly match: (r: FakeRequest) => boolean }
  | { readonly kind: "apply" }
  | { readonly kind: "committed" };

interface Cut {
  readonly name: string;
  readonly step: Step;
  readonly kept: Readonly<Record<Sequence, string | null>>;
}

const CUTS: readonly Cut[] = [
  {
    name: "before the key check answers",
    step: { kind: "request", match: (r) => r.path === "/keys/current" },
    kept: { "first build": null, "language rebuild": "en-US" },
  },
  {
    name: "before the group list answers",
    step: { kind: "request", match: (r) => r.path.endsWith("/groups") },
    kept: { "first build": null, "language rebuild": "en-US" },
  },
  {
    name: "before the first library download answers",
    step: { kind: "request", match: (r) => r.path.includes("/items") },
    kept: { "first build": null, "language rebuild": "en-US" },
  },
  {
    name: "inside the apply transaction",
    step: { kind: "apply" },
    kept: { "first build": null, "language rebuild": "en-US" },
  },
  {
    name: "after the commit",
    step: { kind: "committed" },
    kept: { "first build": "en-US", "language rebuild": "en-GB" },
  },
];

type RestartKey = "same" | "other account" | "same account, no library access";
interface Restart {
  readonly key: RestartKey;
  readonly consented: boolean;
  readonly changed: boolean;
}

const RESTARTS: readonly Restart[] = (
  ["same", "other account", "same account, no library access"] as const
).flatMap((key) =>
  [true, false].flatMap((consented) =>
    [false, true].map((changed) => ({ key, consented, changed })),
  ),
);

const nameOf = ({ key, consented, changed }: Restart) =>
  `${key} key, ${consented ? "account 42 consented" : "no consented account"}, ${changed ? "changed" : "same"} language`;

const ROWS = SEQUENCES.flatMap((sequence) =>
  CUTS.flatMap((cut) =>
    RESTARTS.map(
      (restart) => [sequence, cut.name, nameOf(restart), cut, restart] as const,
    ),
  ),
);

const world = Effect.gen(function* () {
  const api = seededApi(SEED, ACCOUNT);
  api.api
    .library({ type: "user", id: 42 })
    .updateItem("MAIN2345", { date: "01/02/2020" });
  api.api.addKey(OTHER_KEY, READ_ALL_ACCESS, {
    userID: 99,
    username: "someone else",
  });
  api.api.addKey(NO_ACCESS_KEY, {}, ACCOUNT);
  const kept = keptEngine(yield* Effect.promise(() => loadMemoryEngine()));
  return { api, engine: Effect.succeed(kept.engine), sqlite: kept.engine };
});

const staging = (
  { sqlite }: Effect.Success<typeof world>,
  options?: StagingCheckOptions,
) =>
  Effect.sync(() => {
    using client = openWasmClient(sqlite, { file: REPLICA_FILE });
    return stagingViolations(client.db, options);
  });

const boot = (
  { api, engine }: Effect.Success<typeof world>,
  key: string,
  {
    zoteroLocale,
    betweenSlices = Effect.void,
    consented = true,
  }: {
    readonly zoteroLocale: string;
    readonly betweenSlices?: Effect.Effect<void>;
    readonly consented?: boolean;
  },
) =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const context = yield* Layer.buildWithScope(
      memoryWebApiSource(api, {
        holdBack: "50 millis",
        engine,
        initial: webApiConfig(key, {
          zoteroLocale,
          consentedUserID: consented ? 42 : undefined,
        }),
        slicing: { pageSize: 1, sliceMillis: 0 },
        betweenSlices,
      }),
      scope,
    );
    return {
      connection: Context.get(context, Connection),
      sync: Context.get(context, WebLibrarySync),
      crash: Scope.close(scope, Exit.void),
    };
  });

const readable = (worker: Effect.Success<ReturnType<typeof boot>>) =>
  Effect.gen(function* () {
    const status = yield* worker.sync.status;
    if (status.state !== "ready") return null;
    const date = yield* Effect.scoped(
      Effect.map(worker.connection.borrow, (client) => storedDate(client)),
    );
    return { date, marker: status.zoteroLocale };
  });

const runSequence = (
  sequence: Sequence,
  cut: Step,
  state: Effect.Success<typeof world>,
) =>
  Effect.gen(function* () {
    const { api } = state;
    let start = "en-US";
    if (sequence === "language rebuild") {
      const built = yield* boot(state, api.key, { zoteroLocale: "en-US" });
      yield* built.connection.refresh;
      yield* built.crash;
      start = "en-GB";
    }
    let applying = false;
    const release =
      cut.kind === "request" ? api.api.hold(cut.match) : () => undefined;
    const before = api.api.requests.length;
    const worker = yield* boot(state, api.key, {
      zoteroLocale: start,
      betweenSlices:
        cut.kind === "apply"
          ? Effect.suspend(() => {
              applying = true;
              return Effect.die("the app stops inside the apply transaction");
            })
          : Effect.void,
    });
    if (cut.kind === "request")
      yield* until(
        () => api.api.requests.slice(before).some(cut.match),
        "the held request",
      );
    if (cut.kind === "apply") {
      yield* until(() => applying, "the apply");
      yield* Effect.exit(worker.connection.refresh);
    }
    if (cut.kind === "committed") yield* worker.connection.refresh;
    yield* worker.crash;
    release();
    return start;
  });

describe("crash points of the Web API source (P1: no account's data is deleted and no other account is downloaded without consent; P2: a committed replica's dates follow the language it records, and converge to the configured one)", () => {
  it.live.each(ROWS)(
    "%s, stopped %s, restarted with the %s",
    ([sequence, _cutName, _restartName, cut, restart]) =>
      Effect.gen(function* () {
        const state = yield* world;
        const { api } = state;
        const started = yield* runSequence(sequence, cut.step, state);
        expect(yield* staging(state)).toEqual([]);
        const kept = cut.kept[sequence];
        const language = restart.changed ? other(started) : started;
        const key = {
          same: api.key,
          "other account": OTHER_KEY,
          "same account, no library access": NO_ACCESS_KEY,
        }[restart.key];
        const allowed = restart.consented && restart.key === "same";

        const before = api.api.requests.length;
        const restarted = yield* boot(state, key, {
          zoteroLocale: language,
          consented: restart.consented,
        });
        yield* Effect.ignore(restarted.connection.refresh);
        const served = yield* readable(restarted);
        const after = yield* restarted.sync.status;
        yield* restarted.crash;

        if (served !== null)
          expect(served.date).toBe(DATES[served.marker ?? "missing"]);
        if (allowed) {
          expect(after.problem).toBeNull();
          expect(served).toEqual({ date: DATES[language], marker: language });
        } else {
          expect(served).toEqual(
            kept === null ? null : { date: DATES[kept], marker: kept },
          );
          if (restart.key === "other account")
            expect(
              api.api.requests
                .slice(before)
                .filter((request) => request.path !== "/keys/current"),
            ).toEqual([]);
        }

        const converged = yield* boot(state, api.key, {
          zoteroLocale: language,
        });
        yield* converged.connection.refresh;
        expect(yield* readable(converged)).toEqual({
          date: DATES[language],
          marker: language,
        });
        yield* converged.crash;
        expect(yield* staging(state, { afterApply: true })).toEqual([]);
      }),
  );
});

it.live(
  "downloads nothing with no consented account: it verifies the key and reports its account",
  () =>
    Effect.gen(function* () {
      const state = yield* world;
      const scope = yield* Scope.make();
      const context = yield* Layer.buildWithScope(
        memoryWebApiSource(state.api, {
          holdBack: "50 millis",
          engine: state.engine,
          initial: webApiConfig(state.api.key, { consentedUserID: undefined }),
        }),
        scope,
      );
      yield* Context.get(context, Connection).refresh;
      expect(yield* Context.get(context, WebLibrarySync).status).toMatchObject({
        unconsentedUserID: 42,
        problem: null,
      });
      expect(
        state.api.api.requests.filter(
          (request) => request.path !== "/keys/current",
        ),
      ).toEqual([]);
      yield* Scope.close(scope, Exit.void);
    }),
);
