import { it } from "@effect/vitest";
import { Effect, Scheduler } from "effect";
import type { CliData } from "obsidian";
import { describe, expect } from "vitest";

import { openScenarioDatabase } from "@zotlit/db-testing/scenario";
import type { ScenarioDatabase } from "@zotlit/db-testing/scenario";
import { connectClient } from "@zotlit/db/client/node";
import type { NodeDatabaseClient } from "@zotlit/db/client/node";
import { ItemQueryDatabase } from "@zotlit/db/item-query";
import { ItemQueryScheduler } from "@zotlit/item-query";
import { MY_LIBRARY_SCOPE } from "@zotlit/zotero-reads/contract/library-scope.ts";

import {
  ANNOTATION_GUIDE_EXAMPLES,
  ANNOTATION_GUIDE_FILTERS,
} from "./annotation-guide.ts";
import { answer } from "./answer.ts";
import { QUERY_COMMAND } from "./contract.ts";
import { decodeQuery } from "./decode.ts";

const IDENTITY = {
  vault: { name: "Research", path: "/vaults/research" },
  source: { id: "source-1", databasePath: "/zotero/zotero.sqlite" },
};

function runAnnotationQuery(
  scenario: ScenarioDatabase<NodeDatabaseClient>,
  params: CliData,
) {
  return decodeQuery({ ...params, from: "annotations" }).pipe(
    Effect.flatMap((decoded) =>
      answer(
        {
          schema: false,
          dataset: "annotations",
          command: QUERY_COMMAND,
          query: decoded,
          scope: MY_LIBRARY_SCOPE,
        },
        { identity: IDENTITY },
      ),
    ),
    Effect.scoped,
    Effect.provideService(ItemQueryDatabase, { client: scenario.db }),
    Effect.provideService(Scheduler.Scheduler, new ItemQueryScheduler()),
    Effect.map((reply) => JSON.parse(reply.answer) as Record<string, unknown>),
  );
}

describe("zotlit:query-guide", () => {
  it.effect(
    "shows only query examples and Filter Expressions that execute",
    () =>
      Effect.gen(function* () {
        const scenario = yield* Effect.acquireDisposable(
          Effect.sync(() =>
            openScenarioDatabase(connectClient, { annotations: true }),
          ),
        );
        const failures: object[] = [];

        for (const args of ANNOTATION_GUIDE_EXAMPLES) {
          const answer = yield* runAnnotationQuery(scenario, args);
          if (
            !answer.ok ||
            !Array.isArray(answer.warnings) ||
            answer.warnings.length > 0
          )
            failures.push({ args, answer });
        }
        for (const filter of ANNOTATION_GUIDE_FILTERS) {
          const answer = yield* runAnnotationQuery(scenario, {
            filter,
            fields: "[]",
          });
          if (
            !answer.ok ||
            !Array.isArray(answer.warnings) ||
            answer.warnings.length > 0
          )
            failures.push({ filter, answer });
        }

        expect(ANNOTATION_GUIDE_EXAMPLES.length).toBeGreaterThan(0);
        expect(ANNOTATION_GUIDE_FILTERS.length).toBeGreaterThan(0);
        expect(failures).toEqual([]);
      }),
  );
});
