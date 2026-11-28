import { it } from "@effect/vitest";
import { Cause, Effect, Exit } from "effect";
import type { CliData } from "obsidian";
import { expect } from "vitest";

import { openScenarioDatabase } from "@zotlit/db-testing/scenario";
import type { ScenarioDatabase } from "@zotlit/db-testing/scenario";
import { connectClient } from "@zotlit/db/client/node";
import type { NodeDatabaseClient } from "@zotlit/db/client/node";
import { ItemQueryDatabase } from "@zotlit/db/item-query";
import { CliRejection } from "@zotlit/obsidian-kit/cli-params.ts";
import type { LibraryScope } from "@zotlit/zotero-reads/contract/library-scope.ts";
import { MY_LIBRARY_SCOPE } from "@zotlit/zotero-reads/contract/library-scope.ts";

import { decodeValues } from "./decode.ts";

import { answerText } from "#__fixtures__/item-query/answer-text.ts";
import { encodeCommand } from "#worker/item-query/answer.ts";

const identity = {
  vault: { name: "Research", path: "/vaults/research" },
  source: {
    kind: "file" as const,
    id: "source-1",
    databasePath: "/zotero/zotero.sqlite",
  },
};

it.effect("decodes the required kind and query defaults as plain JSON", () =>
  Effect.gen(function* () {
    expect(yield* decodeValues({ kind: "collections" })).toEqual({
      kind: "collections",
      libraries: null,
      limit: 100,
    });
    expect(
      yield* decodeValues({
        kind: "tags",
        library: "group:4815",
        match: "READ",
        limit: "all",
      }),
    ).toEqual({
      kind: "tags",
      libraries: {
        scope: {
          mode: "selected",
          libraries: [{ type: "group", groupID: 4815 }],
        },
        parameter: "library",
      },
      match: "READ",
      limit: null,
    });
  }),
);

it.effect.each<CliData>([
  {},
  { kind: "items" },
  { kind: "collections", library: "personal,group:4815" },
  { kind: "tags", library: "group:0" },
  { kind: "tags", limit: "0" },
  { kind: "tags", limit: "1.5" },
  { kind: "tags", limit: "9007199254740992" },
  { kind: "tags", fields: "title" },
])("rejects invalid listing arguments: %j", (params) =>
  Effect.gen(function* () {
    expect(yield* Effect.flip(decodeValues(params))).toBeInstanceOf(
      CliRejection,
    );
  }),
);

const listingOf = (
  scenario: ScenarioDatabase<NodeDatabaseClient>,
  params: CliData,
  scope: LibraryScope = MY_LIBRARY_SCOPE,
) =>
  decodeValues(params).pipe(
    Effect.flatMap((values) =>
      answerText(
        { schema: false, command: "zotlit:query-values", values, scope },
        { identity: Effect.succeed(identity) },
      ),
    ),
    Effect.scoped,
    Effect.provideService(ItemQueryDatabase, { client: scenario.db }),
    Effect.map((text) => JSON.parse(text)),
  );

const scenarioOf = Effect.acquireDisposable(
  Effect.sync(() => openScenarioDatabase(connectClient)),
);

it.effect(
  "lists sorted live Collection paths per Library, including empty Collections",
  () =>
    Effect.gen(function* () {
      const scenario = yield* scenarioOf;
      scenario.sqlite
        .prepare(
          "insert into collections (collectionName, libraryID, key) values ('Empty', 1, 'EMPTYCL2')",
        )
        .run();
      expect(
        yield* listingOf(scenario, { kind: "collections", library: "all" }),
      ).toEqual({
        contractVersion: 4,
        command: "zotlit:query-values",
        ok: true,
        identity,
        libraries: [
          { type: "personal" },
          { type: "group", groupID: 4815, name: "Methods Reading Group" },
        ],
        request: {
          kind: "collections",
          library: ["personal", "group:4815"],
          limit: 100,
        },
        returnedCount: 6,
        truncated: false,
        values: [
          {
            library: "personal",
            name: "My Library",
            totalCount: 5,
            returnedCount: 5,
            truncated: false,
            values: [
              "Empty",
              "Teaching",
              "Teaching/Methods",
              "Thesis",
              "Thesis/Methods",
            ],
          },
          {
            library: "group:4815",
            name: "Methods Reading Group",
            totalCount: 1,
            returnedCount: 1,
            truncated: false,
            values: ["Methods"],
          },
        ],
      });
    }),
);

it.effect(
  "lists Tag types with case-insensitive match and a limit per Library",
  () =>
    Effect.gen(function* () {
      const scenario = yield* scenarioOf;
      expect(
        yield* listingOf(scenario, {
          kind: "tags",
          library: "all",
          match: "READ",
          limit: "1",
        }),
      ).toMatchObject({
        request: { kind: "tags", match: "READ", limit: 1 },
        returnedCount: 2,
        truncated: true,
        values: [
          {
            library: "personal",
            totalCount: 2,
            returnedCount: 1,
            truncated: true,
            values: [{ name: "to-read", type: "manual" }],
          },
          {
            library: "group:4815",
            totalCount: 1,
            returnedCount: 1,
            truncated: false,
            values: [{ name: "to-read", type: "manual" }],
          },
        ],
      });
    }),
);

it.effect.each([
  [
    { kind: "collections", match: "METHODS", limit: "1" },
    {
      totalCount: 2,
      returnedCount: 1,
      truncated: true,
      values: ["Teaching/Methods"],
    },
  ],
  [
    { kind: "collections", match: "methods", limit: "all" },
    {
      totalCount: 2,
      returnedCount: 2,
      truncated: false,
      values: ["Teaching/Methods", "Thesis/Methods"],
    },
  ],
  [
    { kind: "collections", match: "absent" },
    { totalCount: 0, returnedCount: 0, truncated: false, values: [] },
  ],
  [
    { kind: "tags", match: "READ", limit: "all" },
    {
      totalCount: 2,
      returnedCount: 2,
      truncated: false,
      values: [
        { name: "to-read", type: "manual" },
        { name: "To-Read", type: "auto" },
      ],
    },
  ],
] as const)("filters and limits values: %j", ([params, expected]) =>
  Effect.gen(function* () {
    const scenario = yield* scenarioOf;
    expect(yield* listingOf(scenario, params)).toMatchObject({
      ok: true,
      libraries: [{ type: "personal" }],
      values: [{ library: "personal", ...expected }],
    });
  }),
);

it.effect.each([
  [
    { kind: "collections", library: "group:999" },
    MY_LIBRARY_SCOPE,
    "library-not-found",
  ],
  [
    { kind: "tags" },
    { mode: "selected", libraries: [{ type: "group", groupID: 999 }] },
    "no-library-available",
  ],
] as const)("reports unavailable Libraries: %j", ([params, scope, code]) =>
  Effect.gen(function* () {
    const scenario = yield* scenarioOf;
    const result = yield* listingOf(scenario, params, scope);
    expect(result).toMatchObject({
      ok: false,
      command: "zotlit:query-values",
      diagnostic: { code },
    });
    expect(result.diagnostic.report.at(-1)).toBe(result.diagnostic.hint);
  }),
);

it.effect(
  "gives a listing above the inline limit in full, because the window owns the limit",
  () =>
    Effect.gen(function* () {
      const scenario = yield* scenarioOf;
      scenario.sqlite
        .prepare(
          "insert into collections (collectionName, libraryID, key) values (?, 1, 'HUGECL22')",
        )
        .run("a".repeat(1024 * 1024));
      const result = yield* listingOf(scenario, {
        kind: "collections",
        limit: "all",
      });
      expect(result).toMatchObject({ ok: true });
      expect(JSON.stringify(result).length).toBeGreaterThan(1024 * 1024);
    }),
);

it.effect(
  "encodes a long listing in pieces, so a reader that stops early stops the encoding",
  () =>
    Effect.gen(function* () {
      const scenario = yield* scenarioOf;
      const insert = scenario.sqlite.prepare(
        "insert into collections (collectionName, libraryID, key) values (?, 1, ?)",
      );
      for (let index = 0; index < 20_000; index++)
        insert.run(
          `Collection ${String(index).padStart(5, "0")} ${"x".repeat(40)}`,
          `K${String(index).padStart(7, "0")}`,
        );
      const values = yield* decodeValues({
        kind: "collections",
        limit: "all",
      });
      const job = {
        schema: false as const,
        command: "zotlit:query-values" as const,
        values,
        scope: MY_LIBRARY_SCOPE,
      };
      const env = { identity: Effect.succeed(identity) };
      const text = yield* answerText(job, env).pipe(
        Effect.provideService(ItemQueryDatabase, { client: scenario.db }),
      );
      expect(text).toBe(JSON.stringify(JSON.parse(text), null, 2));
      const complete = Buffer.byteLength(text);
      const STOP = 256 * 1024;
      let encoded = 0;

      const exit = yield* encodeCommand(job, env, {
        head: () => Effect.void,
        emit: (piece) => {
          encoded += Buffer.byteLength(piece);
          return encoded >= STOP ? Effect.interrupt : Effect.void;
        },
      }).pipe(
        Effect.provideService(ItemQueryDatabase, { client: scenario.db }),
        Effect.exit,
      );

      expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(
        true,
      );
      expect(complete).toBeGreaterThan(4 * STOP);
      expect(encoded).toBeLessThan(STOP + 1024);
    }),
);

it.effect.each<CliData>([
  { kind: "tags", library: "all", limit: "all" },
  { kind: "tags", library: "all", match: "no such tag" },
  { kind: "collections", library: "all" },
])("encodes a listing as the pretty JSON of its envelope: %j", (params) =>
  Effect.gen(function* () {
    const scenario = yield* scenarioOf;
    const text = yield* decodeValues(params).pipe(
      Effect.flatMap((values) =>
        answerText(
          {
            schema: false,
            command: "zotlit:query-values",
            values,
            scope: MY_LIBRARY_SCOPE,
          },
          { identity: Effect.succeed(identity) },
        ),
      ),
      Effect.provideService(ItemQueryDatabase, { client: scenario.db }),
    );
    expect(text).toBe(JSON.stringify(JSON.parse(text), null, 2));
  }),
);
