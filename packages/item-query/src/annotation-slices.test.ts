import { expect, it } from "vitest";

import {
  BULK_LIBRARY,
  openScenarioDatabase,
  seedBulkAnnotations,
  seedBulkLibrary,
} from "@zotlit/db-testing/scenario";
import { connectClient } from "@zotlit/db/client/node";

import { runEffect } from "./__fixtures__/test-helpers.ts";
import { ANNOTATIONS, collectQuery, ITEMS } from "./index.ts";
import { ItemQueryScheduler, SLICE_BUDGET_MS } from "./scheduler.ts";

const PAGE_MS = 10;
const OTHER_MS = 0.05;

it.each([
  { dataset: ITEMS, reader: "scan-page" },
  { dataset: ANNOTATIONS, reader: "annotation-scan-page" },
])(
  "checks the slice budget between $reader statements",
  async ({ dataset, reader }) => {
    using scenario = openScenarioDatabase(connectClient);
    seedBulkLibrary(scenario.sqlite, 3_000);
    seedBulkAnnotations(scenario.sqlite, 3_000);
    let clock = 0;
    let start = 0;
    let pages = 0;
    const slices: number[] = [];
    const actual = await runEffect(
      collectQuery(dataset, {
        libraries: [BULK_LIBRARY],
        fields: [],
        sort: [],
        ...(dataset === ANNOTATIONS ? { group: "item.citationKey" } : {}),
      }),
      {
        client: scenario.db,
        scheduler: new ItemQueryScheduler({ now: () => clock }),
        onEvent: (event) => {
          if (event.type === "statement") {
            if (event.statement.reader === reader) pages += 1;
            clock += event.statement.reader === reader ? PAGE_MS : OTHER_MS;
          } else {
            slices.push(clock - start);
            start = clock;
          }
        },
      },
    );
    slices.push(clock - start);
    expect(actual.exit._tag).toBe("Success");
    expect(pages).toBeGreaterThanOrEqual(2);
    expect(actual.pauses).toBeGreaterThan(0);
    expect(Math.max(...slices)).toBeLessThan(SLICE_BUDGET_MS + PAGE_MS);
  },
);
