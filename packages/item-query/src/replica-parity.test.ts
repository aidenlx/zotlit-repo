import { Cause, Exit } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ZoteroDatabase } from "@zotlit/db";
import { SCENARIO_LIBRARIES } from "@zotlit/db-testing/scenario";
import { findLibraryID } from "@zotlit/db/replica";
import { openParityPair } from "@zotlit/db/replica/parity-pair";
import type { ParityPair } from "@zotlit/db/replica/parity-pair";

import { ATTACHMENT_SCENARIO_QUERIES } from "./__fixtures__/attachment-scenario-queries.ts";
import { RELATION_SCENARIO_QUERIES } from "./__fixtures__/relation-scenario-queries.ts";
import { SCENARIO_QUERIES } from "./__fixtures__/scenario-queries.ts";
import type { ScenarioQuery } from "./__fixtures__/scenario-queries.ts";
import { runEffect } from "./__fixtures__/test-helpers.ts";
import type { QueryDataset } from "./dataset.ts";
import { ATTACHMENTS, collectQuery, ITEMS } from "./index.ts";
import type { ItemQueryRequest } from "./index.ts";
import { ItemQueryScheduler } from "./scheduler.ts";

let pair: ParityPair;
let marked: ParityPair;

beforeAll(() => {
  pair = openParityPair();
  marked = openParityPair({ withSentinels: true });
});

afterAll(() => {
  pair?.[Symbol.dispose]();
  marked?.[Symbol.dispose]();
});

async function outcome(
  db: ZoteroDatabase,
  dataset: QueryDataset,
  query: ScenarioQuery,
): Promise<unknown> {
  const request: ItemQueryRequest = {
    ...query.request,
    libraries: query.libraries.map((name) => {
      const library = SCENARIO_LIBRARIES[name];
      return {
        ...library,
        libraryID: findLibraryID(
          db,
          library.groupID === null
            ? { type: "user" }
            : { type: "group", groupID: library.groupID },
        )!,
      };
    }),
  };
  const { exit } = await runEffect(collectQuery(dataset, request), {
    client: db,
    now: query.now,
    timeZone: query.timeZone,
    scheduler: new ItemQueryScheduler({ budgetMs: Infinity }),
  });
  if (Exit.isSuccess(exit))
    return JSON.parse(JSON.stringify({ result: exit.value }));
  const error = Cause.findErrorOption(exit.cause);
  if (error._tag === "None") throw new Error(String(exit.cause));
  return JSON.parse(JSON.stringify({ failure: error.value }));
}

const withRows = new Set<string>();

describe("Item Query on the Web Library Replica", () => {
  const both: readonly ScenarioQuery["libraries"][number][] = [
    "personal",
    "group",
  ];
  const cases: { query: ScenarioQuery; dataset: QueryDataset }[] = [
    ...SCENARIO_QUERIES.map((query) => ({ query, dataset: ITEMS })),
    ...RELATION_SCENARIO_QUERIES.map(({ name, dataset, request }) => ({
      query: { name, libraries: both, request },
      dataset,
    })),
    ...ATTACHMENT_SCENARIO_QUERIES.map((request, index) => ({
      query: {
        name: `attachments #${index} ${JSON.stringify(request)}`,
        libraries: both,
        request,
      },
      dataset: ATTACHMENTS,
    })),
  ];

  it.each(cases)(
    "gives the desktop result for $query.name",
    async ({ query, dataset }) => {
      const desktop = await outcome(pair.desktop.db, dataset, query);
      const replica = await outcome(pair.replica.db, dataset, query);
      expect(replica).toEqual(desktop);
      expect(await outcome(marked.replica.db, dataset, query)).toEqual(desktop);
      if (JSON.stringify(desktop).includes('"indexedKey"'))
        withRows.add(query.name);
    },
  );

  it("compares queries that give rows", () => {
    expect(withRows.size).toBeGreaterThan(400);
  });
});
