import type { Diagnostic } from "#worker/item-query/contract.ts";
import { it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Scheduler } from "effect";
import { isDeepStrictEqual } from "node:util";
import type { CliData } from "obsidian";
import { describe, expect } from "vitest";

import { openScenarioDatabase } from "@zotlit/db-testing/scenario";
import type { ScenarioDatabase } from "@zotlit/db-testing/scenario";
import { connectClient } from "@zotlit/db/client/node";
import type { NodeDatabaseClient } from "@zotlit/db/client/node";
import { ItemQueryDatabase } from "@zotlit/db/item-query";
import { ItemQueryScheduler } from "@zotlit/item-query";
import { fakeCliHost } from "@zotlit/obsidian-kit/__fixtures__/cli-host.ts";
import { MY_LIBRARY_SCOPE } from "@zotlit/zotero-reads/contract/library-scope.ts";
import type { LibraryScope } from "@zotlit/zotero-reads/contract/library-scope.ts";

import {
  createQueryCancelHandler,
  guideHandler,
  registerQueryCli,
} from "./cli.ts";
import { decodeQuery } from "./decode.ts";
import { GUIDE_EXAMPLES, GUIDE_FILTERS, renderGuide } from "./guide.ts";

import { answerText } from "#__fixtures__/item-query/answer-text.ts";
import {
  DIAGNOSTIC_HINTS,
  RESULT_TOO_LARGE_HINTS,
  deliveryDiagnostic,
  diagnostic,
  failure,
  QUERY_CANCEL_COMMAND,
  QUERY_COMMAND,
  QUERY_GUIDE_COMMAND,
  QUERY_SCHEMA_COMMAND,
  QUERY_VALUES_COMMAND,
} from "#worker/item-query/contract.ts";

const itemQueryGuideHandler = guideHandler;

function answerTextOf(
  scenario: ScenarioDatabase<NodeDatabaseClient>,
  scope: LibraryScope = MY_LIBRARY_SCOPE,
) {
  return (params: CliData = {}) =>
    decodeQuery(params).pipe(
      Effect.flatMap((query) =>
        answerText(
          {
            schema: false,
            dataset: query.from,
            command: QUERY_COMMAND,
            query,
            scope,
          },
          {
            identity: Effect.succeed({
              vault: { name: "Research", path: "/vaults/research" },
              source: {
                kind: "file" as const,
                id: "source-1",
                databasePath: "/zotero/zotero.sqlite",
              },
            }),
          },
        ),
      ),
      Effect.scoped,
      Effect.provideService(ItemQueryDatabase, { client: scenario.db }),
      Effect.provideService(Scheduler.Scheduler, new ItemQueryScheduler()),
    );
}

function answerOf(
  scenario: ScenarioDatabase<NodeDatabaseClient>,
  scope: LibraryScope = MY_LIBRARY_SCOPE,
) {
  const answerText = answerTextOf(scenario, scope);
  return (params: CliData = {}) =>
    answerText(params).pipe(
      Effect.map((text) => JSON.parse(text) as Record<string, unknown>),
    );
}

const scenarioOf = (options?: Parameters<typeof openScenarioDatabase>[1]) =>
  Effect.acquireDisposable(
    Effect.sync(() => openScenarioDatabase(connectClient, options)),
  );

describe("zotlit:query-cancel", () => {
  function cancelOf(active: readonly string[]) {
    const requested: string[] = [];
    const handler = createQueryCancelHandler((id) =>
      Effect.sync(() => {
        requested.push(id);
        return active.includes(id);
      }),
    );
    return {
      requested,
      run: (params: CliData) =>
        handler(params).pipe(
          Effect.map((text) => JSON.parse(text) as Record<string, unknown>),
        ),
    };
  }

  it.effect("answers that it requested the cancel of an active query", () =>
    Effect.gen(function* () {
      const { run, requested } = cancelOf(["export-a"]);

      const answer = yield* run({ id: "export-a" });

      expect(answer).toEqual({
        contractVersion: 4,
        command: QUERY_CANCEL_COMMAND,
        ok: true,
        id: "export-a",
        cancelRequested: true,
      });
      expect(requested).toEqual(["export-a"]);
    }),
  );

  it.effect(
    "answers that it requested no cancel for an ID with no active query",
    () =>
      Effect.gen(function* () {
        const { run } = cancelOf(["export-a"]);

        expect(yield* run({ id: "export-b" })).toEqual({
          contractVersion: 4,
          command: QUERY_CANCEL_COMMAND,
          ok: true,
          id: "export-b",
          cancelRequested: false,
        });
      }),
  );

  it.effect.each<[CliData, string]>([
    [{}, "id"],
    [{ id: "" }, "id"],
    [{ id: "a b" }, "id"],
    [{ id: "export-a", limit: "1" }, "limit"],
  ])("rejects %j and cancels nothing", ([params, parameter]) =>
    Effect.gen(function* () {
      const { run, requested } = cancelOf(["export-a"]);

      expect(yield* run(params)).toMatchObject({
        command: QUERY_CANCEL_COMMAND,
        ok: false,
        diagnostic: { code: "invalid-argument", details: { parameter } },
      });
      expect(requested).toEqual([]);
    }),
  );
});

describe("zotlit:query formulas", () => {
  it.effect(
    "answers formula.<name> in each row and echoes formulas in the request",
    () =>
      Effect.gen(function* () {
        const run = answerOf(yield* scenarioOf());

        const answer = yield* run({
          filter: 'indexedKey == "BK2MNTH2"',
          formulas: '{"year":"date.year","unused":"title"}',
          fields: "formula.year",
        });

        expect(answer).toMatchObject({
          ok: true,
          request: {
            formulas: { year: "date.year", unused: "title" },
            fields: ["formula.year"],
          },
          warnings: [
            {
              code: "unused-formula",
              location: { argument: "formulas", path: "unused" },
            },
          ],
          rows: [{ indexedKey: "BK2MNTH2", values: { "formula.year": 2019 } }],
        });
      }),
  );

  it.effect("fails a wrong Formula with a diagnostic that names it", () =>
    Effect.gen(function* () {
      const run = answerOf(yield* scenarioOf());

      const answer = yield* run({
        formulas: '{"short":"title.nope()"}',
        fields: "formula.short",
      });

      expect(answer).toMatchObject({
        ok: false,
        diagnostic: {
          code: "unknown-function",
          location: { argument: "formulas", path: "short" },
          report: expect.arrayContaining([
            expect.stringContaining("formula.short"),
          ]),
        },
      });
    }),
  );
});

describe("zotlit:query formula answer text", () => {
  it.effect.each<[string, CliData]>([
    [
      "a Formula that fields reads",
      {
        filter: 'indexedKey == "BK2MNTH2"',
        formulas: '{"year":"date.year","unused":"title"}',
        fields: "title,formula.year",
      },
    ],
    [
      "a wrong Formula that fields reads",
      { formulas: '{"bad":"title * 2"}', fields: "title,formula.bad" },
    ],
    [
      "a wrong Formula that another Formula reads",
      {
        formulas: '{"a":"formula.bad + 1","bad":"title * 2"}',
        fields: "title,formula.a",
      },
    ],
    [
      "a wrong Formula that the filter reads",
      {
        filter: "formula.bad > 0",
        formulas: '{"bad":"title * 2"}',
        fields: "title",
      },
    ],
    [
      "a Formula that fields reads and no request defines",
      { formulas: '{"year":"date.year"}', fields: "title,formula.yeer" },
    ],
  ])("keeps the answer text for %s", ([, params]) =>
    Effect.gen(function* () {
      const scenario = yield* scenarioOf();

      expect(yield* answerTextOf(scenario)(params)).toMatchSnapshot();
    }),
  );
});

describe("zotlit:query-guide", () => {
  it.effect("answers an unknown topic with the diagnostic envelope", () =>
    Effect.gen(function* () {
      const answer = JSON.parse(
        yield* itemQueryGuideHandler({ topic: "bogus" }),
      );

      expect(answer).toMatchObject({
        contractVersion: 4,
        command: QUERY_GUIDE_COMMAND,
        ok: false,
        diagnostic: {
          code: "invalid-argument",
          details: { parameter: "topic" },
        },
      });
    }),
  );

  it.effect("shows only commands and filters that run", () =>
    Effect.gen(function* () {
      const scenario = yield* scenarioOf({ annotations: true });
      scenario.sqlite
        .prepare(
          "insert into collections (collectionName, libraryID, key) values ('Shared key', 1, 'SHAREDCL')",
        )
        .run();
      const run = answerOf(scenario);
      const failures: string[] = [];

      for (const args of GUIDE_EXAMPLES) {
        const answer = yield* run(args);
        if (!answer.ok || !isDeepStrictEqual(answer.warnings, []))
          failures.push(JSON.stringify({ args, answer }));
      }
      for (const filter of GUIDE_FILTERS) {
        const answer = yield* run({ filter, fields: "[]" });
        if (!answer.ok || !isDeepStrictEqual(answer.warnings, []))
          failures.push(JSON.stringify({ filter, answer }));
      }

      expect(GUIDE_EXAMPLES.length).toBeGreaterThan(0);
      expect(GUIDE_FILTERS.length).toBeGreaterThan(0);
      expect(failures).toEqual([]);
    }),
  );

  it("prints each diagnostic code of the adapter with its recovery text", () => {
    const [, list] = renderGuide("results").split(
      "a diagnostic can give a more specific action:\n",
    );
    const printed = Object.fromEntries(
      list!
        .trim()
        .split(/\n {2}(?! )/)
        .map((entry) => {
          const text = entry.replaceAll(/\n {4}/g, " ");
          const at = text.indexOf(": ");
          return [text.slice(0, at), text.slice(at + 2)];
        }),
    );

    expect(printed).toEqual({
      ...DIAGNOSTIC_HINTS,
      ...Object.fromEntries(
        Object.entries(RESULT_TOO_LARGE_HINTS).map(([command, hint]) => [
          `result-too-large from ${command}`,
          hint,
        ]),
      ),
    });
  });

  it("shows each example where a shell passes it through unchanged", () => {
    const quoted = GUIDE_EXAMPLES.flatMap(Object.values).filter((value) =>
      value.includes("'"),
    );

    expect(quoted).toEqual([]);
  });
});

describe("registerQueryCli", () => {
  it.effect(
    "registers the command with its flags and cancels a run when its handler is interrupted",
    () =>
      Effect.gen(function* () {
        const { host, commands, command } = fakeCliHost();
        const started = yield* Deferred.make<void>();
        const interrupted = yield* Deferred.make<void>();

        registerQueryCli(host, {
          query: () =>
            Deferred.succeed(started, undefined).pipe(
              Effect.andThen(Effect.never),
              Effect.onInterrupt(() =>
                Deferred.succeed(interrupted, undefined),
              ),
            ),
          cancel: (id) => Effect.succeed(id === "export-a"),
          schema: () => Effect.succeed(""),
          values: () => Effect.succeed("values"),
        });

        expect(command(QUERY_COMMAND).flags).toEqual(
          expect.objectContaining({
            filter: expect.any(Object),
            fields: expect.any(Object),
            sort: expect.any(Object),
            limit: expect.any(Object),
            library: expect.any(Object),
            from: expect.any(Object),
            id: expect.any(Object),
          }),
        );
        expect(command(QUERY_CANCEL_COMMAND).flags).toEqual(
          expect.objectContaining({ id: expect.any(Object) }),
        );
        expect(command("zotlit:query-values").flags).toEqual(
          expect.objectContaining({
            kind: expect.any(Object),
            library: expect.any(Object),
            match: expect.any(Object),
            limit: expect.any(Object),
          }),
        );
        const handlerFor = (name: string) => command(name).handler;
        expect(
          yield* handlerFor("zotlit:query-values")({ kind: "collections" }),
        ).toBe("values");
        expect(
          JSON.parse(
            yield* handlerFor(QUERY_CANCEL_COMMAND)({ id: "export-a" }),
          ),
        ).toMatchObject({ cancelRequested: true });
        expect(command(QUERY_SCHEMA_COMMAND).flags).toEqual(
          expect.objectContaining({ from: expect.any(Object) }),
        );
        expect(command(QUERY_GUIDE_COMMAND).flags).toEqual(
          expect.objectContaining({ topic: expect.any(Object) }),
        );
        expect([...commands.keys()]).toEqual([
          "zotlit:query",
          "zotlit:query-schema",
          "zotlit:query-values",
          "zotlit:query-guide",
          "zotlit:query-cancel",
        ]);
        const run = yield* Effect.forkChild(handlerFor(QUERY_COMMAND)({}));
        yield* Deferred.await(started);
        expect(yield* Deferred.isDone(interrupted)).toBe(false);
        yield* Fiber.interrupt(run);
        expect(yield* Deferred.isDone(interrupted)).toBe(true);
      }),
  );
});

it.each(Object.keys(DIAGNOSTIC_HINTS) as (keyof typeof DIAGNOSTIC_HINTS)[])(
  "renders operational %s without an excerpt",
  (code) => {
    const value = diagnostic(code, "Operational failure");
    const answer = JSON.parse(failure(QUERY_COMMAND, value)) as {
      diagnostic: Diagnostic;
    };
    expect(answer.diagnostic).toMatchObject({
      severity: "error",
      found: "",
      expected: [],
      suggestions: [],
    });
    expect(answer.diagnostic.report).toEqual([value.message, value.hint]);
    expect(answer.diagnostic.excerpt).toBeUndefined();
  },
);

it.each([
  [QUERY_COMMAND, DIAGNOSTIC_HINTS["result-too-large"]],
  [QUERY_VALUES_COMMAND, RESULT_TOO_LARGE_HINTS[QUERY_VALUES_COMMAND]],
  [QUERY_SCHEMA_COMMAND, RESULT_TOO_LARGE_HINTS[QUERY_SCHEMA_COMMAND]],
] as const)(
  "gives result-too-large of %s the recovery action of that command",
  (command, hint) => {
    const value = deliveryDiagnostic(
      "result-too-large",
      "The JSON response exceeds the inline limit.",
      command,
    );
    expect(value).toMatchObject({ code: "result-too-large", hint });
    expect(value.report.at(-1)).toBe(hint);
  },
);
