import { it } from "@effect/vitest";
import { Context, Effect, Layer } from "effect";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect } from "vitest";

import { FakeZoteroApi } from "@zotlit/web-library/fake-zotero-api";
import {
  newApiKey,
  READ_ALL_ACCESS,
} from "@zotlit/web-library/fake-zotero-api/scenario";
import {
  changeSeededItems,
  seedLibrary,
} from "@zotlit/web-library/fake-zotero-api/seed";

import { Connection } from "#worker/connection.ts";
import type { ReplicaDriver, ReplicaWrites } from "#worker/replica-driver.ts";

import { FAKE_API_URL, fakeApiFetch, memoryWebApiSource } from "./web-api.ts";

export const UPDATE_COUNT_BASELINES_ENV = "ZOTLIT_UPDATE_COUNT_BASELINES";

export const COUNT_MARGIN = 0.05;

export interface SyncCounts {
  readonly stage: {
    readonly writes: number;
    readonly statements: number;
    readonly changes: number;
  };
  readonly apply: {
    readonly applies: number;
    readonly statements: number;
    readonly changes: number;
  };
}

type Baseline = Record<string, SyncCounts>;

export interface ReplicaCountsSuite {
  readonly driver: () => Promise<ReplicaDriver>;
  readonly baseline: URL;
}

const ACCOUNT = { userID: 42, username: "reader" } as const;

const SEEDS = [
  { items: 5_000, changed: 100 },
  { items: 50_000, changed: 5_000 },
] as const;

const count = (items: number) => items.toLocaleString("en-US");

export function countOutside(actual: number, baseline: number): boolean {
  return Math.abs(actual - baseline) > baseline * COUNT_MARGIN;
}

type CountRow = Readonly<Record<string, number>>;

function compare(name: string, actual: SyncCounts, baseline?: SyncCounts) {
  if (!baseline) return [`${name}: no baseline`];
  const problems: string[] = [];
  for (const part of ["stage", "apply"] as const) {
    const expectedRow: CountRow = baseline[part];
    for (const [field, value] of Object.entries(actual[part])) {
      const expected = expectedRow[field];
      if (expected === undefined || countOutside(value, expected))
        problems.push(
          `${name}: ${part} ${field} is ${value}, the baseline is ${expected} (margin ${COUNT_MARGIN * 100}%)`,
        );
    }
  }
  return problems;
}

const noCounts = () => ({
  stage: { writes: 0, statements: 0, changes: 0 },
  apply: { applies: 0, statements: 0, changes: 0 },
});

function recorder() {
  let counts = noCounts();
  const add = (
    bucket: { statements: number; changes: number },
    { statements, changes }: ReplicaWrites,
  ) => {
    bucket.statements += statements;
    bucket.changes += changes;
  };
  return {
    observer: {
      staged: (writes: ReplicaWrites) => {
        counts.stage.writes++;
        add(counts.stage, writes);
      },
      maintained: (writes: ReplicaWrites) => add(counts.stage, writes),
      applied: (writes: ReplicaWrites) => {
        counts.apply.applies++;
        add(counts.apply, writes);
      },
    },
    take: (): SyncCounts => {
      const taken = counts;
      counts = noCounts();
      return taken;
    },
  };
}

export function describeReplicaCounts(
  name: string,
  suite: ReplicaCountsSuite,
): void {
  const updating = process.env[UPDATE_COUNT_BASELINES_ENV] === "1";
  const committed: Baseline = existsSync(suite.baseline)
    ? (JSON.parse(readFileSync(suite.baseline, "utf8")) as Baseline)
    : {};
  const measured: Baseline = {};

  describe(`the count guards of the Replica Store on ${name}`, () => {
    for (const seed of SEEDS)
      it.live(
        `keeps the statements and changed rows of a first build of ${count(seed.items)} items and a sync of ${count(seed.changed)} changed items at the baseline`,
        () =>
          Effect.gen(function* () {
            const api = new FakeZoteroApi({ ...ACCOUNT, baseUrl: FAKE_API_URL });
            seedLibrary(api.user, { items: seed.items });
            const key = newApiKey();
            api.addKey(key, READ_ALL_ACCESS);
            const counts = recorder();
            const driver = yield* Effect.promise(() => suite.driver());
            const context = yield* Layer.build(
              memoryWebApiSource(
                { api, key, fetch: fakeApiFetch(api) },
                { driver: Effect.succeed(driver), observer: counts.observer },
              ),
            );
            const connection = Context.get(context, Connection);
            yield* connection.refresh;
            const build = `first build of ${count(seed.items)} items`;
            measured[build] = counts.take();
            changeSeededItems(api.user, { items: seed.changed, round: 1 });
            yield* connection.refresh;
            const change = `sync of ${count(seed.changed)} changed items in ${count(seed.items)}`;
            measured[change] = counts.take();
            expect(measured[build].apply.changes).toBeGreaterThan(seed.items);
            expect(measured[change].apply.changes).toBeGreaterThanOrEqual(
              seed.changed,
            );
            if (updating) {
              writeFileSync(
                suite.baseline,
                `${JSON.stringify({ ...committed, ...measured }, null, 2)}\n`,
              );
              return;
            }
            expect(
              [build, change].flatMap((which) =>
                compare(which, measured[which]!, committed[which]),
              ),
              `Counts outside the baseline. If the change is intended, run the guard with ${UPDATE_COUNT_BASELINES_ENV}=1 and commit ${suite.baseline.pathname.split("/").at(-1)}.`,
            ).toEqual([]);
          }).pipe(Effect.scoped),
        600_000,
      );
  });
}
