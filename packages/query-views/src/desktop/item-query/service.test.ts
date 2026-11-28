import type { WorkerMeasurement } from "#worker/item-query/trace.ts";
import type {
  QueryJob,
  QueryTypedJob,
} from "#worker/item-query/worker-protocol.ts";
import { describe, expect, it, vi } from "@effect/vitest";
import {
  Cause,
  Context,
  DateTime,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Option,
  Queue,
  Scope,
  Stream,
  SubscriptionRef,
} from "effect";
import { chmod, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CliData } from "obsidian";

import {
  BULK_LIBRARY,
  bulkItemKey,
  openScenarioDatabase,
  seedBulkLibrary,
} from "@zotlit/db-testing/scenario";
import type { ScenarioDatabase } from "@zotlit/db-testing/scenario";
import { connectClient } from "@zotlit/db/client/node";
import type { NodeDatabaseClient } from "@zotlit/db/client/node";
import { valueText } from "@zotlit/item-query";
import type { ProjectionJson } from "@zotlit/item-query";
import { UseLedger } from "@zotlit/plugin-services/obsidian/use-ledger/service.ts";
import type { Ledger } from "@zotlit/plugin-services/obsidian/use-ledger/service.ts";
import { delimited } from "@zotlit/shared/delimited";
import {
  fileConfig,
  inProcessClient,
  inProcessReadsService,
  sharedClientOpener,
} from "@zotlit/zotero-reads/__fixtures__/in-process.ts";
import { readsAnswering } from "@zotlit/zotero-reads/__fixtures__/reads.ts";
import {
  layerZoteroReads,
  ZoteroReads,
} from "@zotlit/zotero-reads/client/service.ts";
import { MY_LIBRARY_SCOPE } from "@zotlit/zotero-reads/contract/library-scope.ts";
import type { ZoteroReadsClient } from "@zotlit/zotero-reads/contract/rpc.ts";
import {
  Connection,
  layerRcRef,
} from "@zotlit/zotero-reads/worker/connection.ts";
import type { ConnectionOpener } from "@zotlit/zotero-reads/worker/connection.ts";
import type { QueryJobRunner } from "@zotlit/zotero-reads/worker/handlers.ts";

import { queryJobRunner } from "./job.ts";
import { QueryService } from "./service.ts";

import {
  buildQueryService,
  layerTestQueryService,
} from "#__fixtures__/item-query.ts";
import {
  QUERY_VALUES_COMMAND,
  RESULT_TOO_LARGE_HINTS,
  queryCancelledText,
} from "#worker/item-query/contract.ts";

const scenarioOf = (options?: Parameters<typeof openScenarioDatabase>[1]) =>
  Effect.acquireDisposable(
    Effect.sync(() => openScenarioDatabase(connectClient, options)),
  );

const SOURCE = (scenario: ScenarioDatabase<NodeDatabaseClient>) => ({
  sourceId: "captured-source",
  databasePath: scenario.path,
  dataDir: dirname(scenario.path),
  baseAttachmentPath: join(dirname(scenario.path), "linked"),
});

function counter() {
  const state = {
    leases: 0,
    jobs: [] as (QueryJob | QueryTypedJob)[],
    answerOptions: [] as unknown[],
  };
  const wrap = (client: ZoteroReadsClient): ZoteroReadsClient => ({
    ...client,
    ItemQuery: (payload, options) => {
      state.jobs.push(payload.job);
      return Effect.acquireUseRelease(
        Effect.sync(() => {
          state.leases++;
        }),
        () => client.ItemQuery(payload, options),
        () =>
          Effect.sync(() => {
            state.leases--;
          }),
      );
    },
    QueryAnswer: ((
      payload: Parameters<ZoteroReadsClient["QueryAnswer"]>[0],
      options?: { readonly streamBufferSize?: number },
    ) => {
      state.jobs.push(payload.job);
      state.answerOptions.push(options);
      return Stream.unwrap(
        Effect.acquireRelease(
          Effect.sync(() => {
            state.leases++;
          }),
          () =>
            Effect.sync(() => {
              state.leases--;
            }),
        ).pipe(Effect.as(client.QueryAnswer(payload, options))),
      );
    }) as ZoteroReadsClient["QueryAnswer"],
  });
  return { state, wrap };
}

const harness = Effect.fnUntraced(function* (
  scenario: ScenarioDatabase<NodeDatabaseClient>,
  opener: ConnectionOpener = sharedClientOpener(scenario.db),
  queryJobs: QueryJobRunner = queryJobRunner,
) {
  const { state, wrap } = counter();
  let borrows = 0;
  let borrowed = 0;
  let idle: Deferred.Deferred<void> | undefined;
  const connection = Layer.effect(
    Connection,
    Effect.map(Connection, (opened) =>
      Connection.of({
        ...opened,
        borrow: Effect.acquireRelease(
          Effect.sync(() => {
            borrows++;
            borrowed++;
          }),
          () =>
            Effect.sync(() => {
              borrows--;
              if (borrows > 0 || idle === undefined) return;
              Deferred.doneUnsafe(idle, Exit.void);
              idle = undefined;
            }),
        ).pipe(Effect.andThen(opened.borrow)),
      }),
    ),
  ).pipe(Layer.provide(layerRcRef(opener)));
  const client = Effect.map(
    inProcessClient(
      connection,
      { queryJobs },
      fileConfig(scenario.path, SOURCE(scenario).sourceId),
    ),
    (client) => wrap(client),
  );
  const { reads } = Context.get(
    yield* Layer.build(layerZoteroReads(client)),
    ZoteroReads,
  );
  const serviceScope = yield* Scope.fork(yield* Scope.Scope);
  const context = yield* Layer.buildWithScope(
    layerTestQueryService({
      reads,
      pluginVersion: "2.2.0-beta.2",
      source: SOURCE(scenario),
      effective: () => MY_LIBRARY_SCOPE,
      vaultName: "Query tests",
      basePath: dirname(scenario.path),
    }),
    serviceScope,
  );
  return {
    service: Context.get(context, QueryService),
    leases: () => state.leases,
    jobs: () => state.jobs,
    answerOptions: () => state.answerOptions,
    borrowsReleased: Effect.suspend(() =>
      borrows === 0
        ? Effect.void
        : Deferred.await((idle ??= Deferred.makeUnsafe<void>())),
    ),
    borrowed: () => borrowed,
    unload: Scope.close(serviceScope, Exit.void),
  };
});

const json = <E>(answer: Effect.Effect<string, E>) =>
  Effect.map(answer, (text) => JSON.parse(text));

const started = <A, E>(call: Effect.Effect<A, E>) =>
  Effect.forkChild(call, { startImmediately: true });

const interruptedOnly = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause);

const files = (directory: string) => Effect.promise(() => readdir(directory));
const temporary = (names: readonly string[]) =>
  names.filter((name) => name.endsWith(".zotlit-partial"));
const readText = (path: string) => Effect.promise(() => readFile(path, "utf8"));
const nextTurn = Effect.promise(
  () => new Promise((resolve) => setTimeout(resolve, 0)),
);
const exportStarted = (directory: string) =>
  Effect.promise(() =>
    vi.waitFor(
      async () => {
        expect(temporary(await readdir(directory)).length).toBeGreaterThan(0);
      },
      { timeout: 15000, interval: 1 },
    ),
  );

const bulk = {
  library: `group:${BULK_LIBRARY.groupID}`,
  limit: "all",
  fields: '["title","tags"]',
};

const DATASETS = [
  {
    dataset: "items",
    command: "zotlit:query",
    schemaCommand: "zotlit:query-schema",
    asset: "query",
    params: { limit: "all", fields: '["title","date","creators"]' },
    returnedCount: 10,
    defaults: {
      fields: ["itemType", "title", "creators", "date", "dateModified"],
      sort: [{ field: "dateModified", direction: "desc" }],
      limit: 100,
      library: { source: "library-scope" },
    },
    customField: { path: 'custom["review.status"]' },
  },
  {
    dataset: "annotations",
    command: "zotlit:query",
    schemaCommand: "zotlit:query-schema",
    asset: "query",
    params: { filter: 'item.indexedKey == "ART2FULL"', limit: "all" },
    returnedCount: 12,
    defaults: {
      fields: [
        "type",
        "text",
        "comment",
        "color",
        "colorName",
        "pageLabel",
        "pageIndex",
        "tags",
        "dateAdded",
        "dateModified",
        "hasExcerptImage",
        "attachment",
        "item.title",
        "item.citationKey",
      ],
      sort: [
        { field: "item.dateModified", direction: "desc" },
        { field: "attachment.indexedKey", direction: "asc" },
        { field: "sortIndex", direction: "asc" },
      ],
      limit: 100,
      library: { source: "library-scope" },
    },
    customField: { path: 'custom["review.status"]' },
  },
] as const;

describe.each(DATASETS)("$dataset CLI dataset through the service", (cli) => {
  const { dataset, command, schemaCommand } = cli;
  const annotated = () =>
    scenarioOf({ storage: "temp-directory", annotations: true });

  it.effect(
    "answers the pretty versioned envelope of the source and keeps the id out of the request",
    () =>
      Effect.gen(function* () {
        const scenario = yield* annotated();
        const { service, leases, jobs } = yield* harness(scenario);

        const text = yield* service.query({
          from: dataset,
          ...cli.params,
          id: "envelope",
        });

        const answer = JSON.parse(text);
        expect(text).toBe(JSON.stringify(answer, null, 2));
        expect(Object.keys(answer)).toEqual([
          "contractVersion",
          "command",
          "ok",
          "identity",
          "libraries",
          "request",
          "returnedCount",
          "truncated",
          "warnings",
          "rows",
        ]);
        expect(answer).toMatchObject({
          contractVersion: 4,
          command,
          ok: true,
          identity: {
            vault: { name: "Query tests" },
            source: {
              kind: "file",
              id: "captured-source",
              databasePath: scenario.path,
            },
          },
          returnedCount: cli.returnedCount,
        });
        expect(answer.request).not.toHaveProperty("id");
        expect(jobs()).toEqual([
          expect.objectContaining({ schema: false, dataset, command }),
        ]);
        expect(jobs()[0]?.attachmentPaths).toEqual({
          dataDir: dirname(scenario.path),
          baseAttachmentPath: join(dirname(scenario.path), "linked"),
        });
        expect(leases()).toBe(0);
      }),
  );

  it.effect(
    "answers query-id-in-use for an id that a query of either dataset holds",
    () =>
      Effect.gen(function* () {
        const { service } = yield* harness(yield* annotated());
        const other = DATASETS.find((entry) => entry.dataset !== dataset)!;
        const first = yield* started(
          service.query({ from: dataset, ...cli.params, id: "job" }),
        );

        for (const { dataset: second, command: answered } of [cli, other]) {
          expect(
            yield* json(service.query({ from: second, id: "job" })),
          ).toEqual({
            contractVersion: 4,
            command: answered,
            ok: false,
            diagnostic: expect.objectContaining({
              code: "query-id-in-use",
              details: { parameter: "id" },
            }),
          });
        }
        expect(JSON.parse(yield* Fiber.join(first))).toMatchObject({
          command,
          ok: true,
        });
        expect(yield* service.cancel("job")).toBe(false);
      }),
  );

  it.effect(
    "exports the inline envelope to a new file, answers its receipt, and keeps an existing file",
    () =>
      Effect.gen(function* () {
        const scenario = yield* annotated();
        const { service, leases } = yield* harness(scenario);
        const inline = yield* service.query({ from: dataset, ...cli.params });
        const output = join(dirname(scenario.path), `${dataset}.json`);

        const receipt = yield* json(
          service.query({ from: dataset, ...cli.params, output }),
        );

        expect(receipt).toMatchObject({
          command,
          ok: true,
          returnedCount: cli.returnedCount,
          file: {
            path: output,
            bytes: Buffer.byteLength(inline),
            format: "json",
          },
        });
        expect(receipt).not.toHaveProperty("rows");
        expect(yield* readText(output)).toBe(inline);
        yield* Effect.promise(() => writeFile(output, "keep this content"));
        expect(
          yield* json(service.query({ from: dataset, ...cli.params, output })),
        ).toMatchObject({
          command,
          ok: false,
          diagnostic: { code: "output-error" },
        });
        expect(yield* readText(output)).toBe("keep this content");
        expect(leases()).toBe(0);
        expect(temporary(yield* files(dirname(output)))).toEqual([]);
      }),
  );

  it.effect("cancels a named export by its id and frees the id", () =>
    Effect.gen(function* () {
      const scenario = yield* annotated();
      const { service, leases } = yield* harness(scenario);
      const output = join(dirname(scenario.path), `cancelled-${dataset}.json`);
      const running = yield* started(
        service.query({ from: dataset, ...cli.params, id: "shared", output }),
      );

      expect(yield* service.cancel("shared")).toBe(true);
      expect(yield* Effect.flip(Fiber.join(running))).toMatchObject({
        _tag: "QueryCancelled",
        message: queryCancelledText("shared"),
      });

      expect(yield* service.cancel("shared")).toBe(false);
      expect(yield* service.runningJobs).toBe(0);
      expect(leases()).toBe(0);
      const names = yield* files(dirname(output));
      expect(names).not.toContain(`cancelled-${dataset}.json`);
      expect(temporary(names)).toEqual([]);
      expect(
        yield* json(
          service.query({ from: dataset, ...cli.params, id: "shared" }),
        ),
      ).toMatchObject({ command, ok: true });
    }),
  );

  it.effect(
    "answers the schema download, source custom fields and CLI defaults",
    () =>
      Effect.gen(function* () {
        const { service, leases, jobs } = yield* harness(yield* annotated());

        const text = yield* service.schema({ from: dataset });

        const answer = JSON.parse(text);
        expect(text).toBe(JSON.stringify(answer, null, 2));
        expect(Object.keys(answer)).toEqual([
          "contractVersion",
          "command",
          "ok",
          "identity",
          "schema",
          "customFields",
          "datasets",
          "defaults",
        ]);
        expect(answer).toMatchObject({
          contractVersion: 4,
          command: schemaCommand,
          ok: true,
          identity: { source: { id: "captured-source" } },
          schema: {
            url: `https://github.com/aidenlx/zotlit/releases/download/res-2.2.0-beta.2/${cli.asset}.schema.json`,
            fileName: `zotlit-${cli.asset}-2.2.0-beta.2.schema.json`,
          },
          customFields: expect.arrayContaining([
            expect.objectContaining(cli.customField),
          ]),
        });
        expect(Object.keys(answer.schema)).toEqual(["url", "fileName"]);
        expect(answer.defaults).toEqual({ [dataset]: cli.defaults });
        expect(jobs()).toEqual([
          expect.objectContaining({
            schema: true,
            dataset,
            command: schemaCommand,
          }),
        ]);
        expect(
          yield* json(service.schema({ from: dataset, library: "personal" })),
        ).toMatchObject({
          contractVersion: 4,
          command: schemaCommand,
          ok: false,
          diagnostic: {
            code: "invalid-argument",
            details: { parameter: "library" },
          },
        });
        expect(jobs()).toHaveLength(1);
        expect(leases()).toBe(0);
      }),
  );

  it.effect(
    "answers a failure with its command: an unknown field, and an unavailable source",
    () =>
      Effect.gen(function* () {
        const scenario = yield* annotated();
        const available = yield* harness(scenario);
        expect(
          yield* json(
            available.service.query({
              from: dataset,
              ...cli.params,
              fields: '["notAField"]',
            }),
          ),
        ).toMatchObject({
          contractVersion: 4,
          command,
          ok: false,
          diagnostic: { code: "unknown-field" },
        });
        const unavailable = yield* harness(scenario, () => {
          throw new Error("source closed");
        });
        for (const [answered, answer] of [
          [command, yield* unavailable.service.query({ from: dataset })],
          [schemaCommand, yield* unavailable.service.schema({ from: dataset })],
        ] as const)
          expect(JSON.parse(answer)).toMatchObject({
            command: answered,
            ok: false,
            diagnostic: { code: "source-unavailable" },
          });
        expect(unavailable.leases()).toBe(0);
      }),
  );
});

describe("Item Query worker jobs", () => {
  it.effect(
    "reports invalid paths and write failures, and leaves no file on a query failure",
    () =>
      Effect.gen(function* () {
        const scenario = yield* scenarioOf({ storage: "temp-directory" });
        const { service, leases } = yield* harness(scenario);
        expect(
          yield* json(
            service.query({ from: "items", output: "relative.json" }),
          ),
        ).toMatchObject({ diagnostic: { code: "invalid-argument" } });
        const output = join(dirname(scenario.path), "missing", "items.json");
        expect(
          yield* json(service.query({ from: "items", output })),
        ).toMatchObject({ diagnostic: { code: "output-error" } });
        expect(
          yield* json(
            service.query({ from: "items", output, fields: '["notAField"]' }),
          ),
        ).toMatchObject({ diagnostic: { code: "unknown-field" } });
        const denied = join(dirname(scenario.path), "denied");
        yield* Effect.promise(() => mkdir(denied, { mode: 0o000 }));
        const answer = yield* json(
          service.query({ from: "items", output: join(denied, "items.json") }),
        ).pipe(Effect.ensuring(Effect.promise(() => chmod(denied, 0o700))));
        expect(answer).toMatchObject({ diagnostic: { code: "output-error" } });
        expect(leases()).toBe(0);
      }),
  );

  it.effect(
    "exports the rows of the JSON answer as CSV and TSV files, a group column first when the query groups",
    () =>
      Effect.gen(function* () {
        const scenario = yield* scenarioOf({
          storage: "temp-directory",
          annotations: true,
        });
        const { service, leases } = yield* harness(scenario);
        const params = {
          from: "items",
          limit: "all",
          fields: '["title","date","creators","tags"]',
        };
        const fields = ["title", "date", "creators", "tags"];
        type Row = {
          indexedKey: string;
          values: Record<string, ProjectionJson>;
        };
        const lines = (rows: readonly Row[], group: string[] = []) =>
          rows.map((row) => [
            ...group,
            row.indexedKey,
            ...fields.map((field) => valueText(row.values[field])),
          ]);
        const answer = (yield* json(service.query(params))) as { rows: Row[] };
        expect(answer.rows.length).toBeGreaterThan(0);

        for (const format of ["csv", "tsv"] as const) {
          const output = join(dirname(scenario.path), `items.${format}`);
          const receipt = yield* json(
            service.query({ ...params, format, output }),
          );
          const text = yield* readText(output);
          expect(receipt).toMatchObject({
            ok: true,
            returnedCount: answer.rows.length,
            file: { path: output, bytes: Buffer.byteLength(text), format },
          });
          expect(receipt).not.toHaveProperty("rows");
          expect(text).toBe(
            delimited(
              [["indexedKey", ...fields], ...lines(answer.rows)],
              format,
            ),
          );
        }
        const csv = yield* Effect.promise(() =>
          readFile(join(dirname(scenario.path), "items.csv")),
        );
        expect([...csv.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
        expect(
          yield* readText(join(dirname(scenario.path), "items.tsv")),
        ).toMatch(/^indexedKey\ttitle\tdate\tcreators\ttags\n/);

        const grouped = { ...params, group: "itemType" };
        const { groups } = (yield* json(service.query(grouped))) as {
          groups: { value: string | null; rows: Row[] }[];
        };
        expect(groups.length).toBeGreaterThan(1);
        const output = join(dirname(scenario.path), "grouped.csv");
        yield* service.query({ ...grouped, format: "csv", output });
        expect(yield* readText(output)).toBe(
          delimited(
            [
              ["group", "indexedKey", ...fields],
              ...groups.flatMap((group) =>
                lines(group.rows, [valueText(group.value)]),
              ),
            ],
            "csv",
          ),
        );
        expect(leases()).toBe(0);
      }),
  );

  it.effect.each<{
    name: string;
    params: CliData;
    totalCount: number;
    returnedCount: number;
    groups: number;
  }>([
    {
      name: "library groups",
      params: { group: "library", library: "all", limit: "1", fields: "[]" },
      totalCount: 12,
      returnedCount: 2,
      groups: 2,
    },
    {
      name: "overlapping element groups",
      params: {
        group: "tags[].name",
        filter: 'tags.contains("methods")',
        library: "personal",
        limit: "all",
        fields: "[]",
        sort: "key",
      },
      totalCount: 2,
      returnedCount: 4,
      groups: 3,
    },
  ])(
    "exports a grouped JSON answer byte-identical to the inline answer, with a receipt that holds no groups: $name",
    ({ params, totalCount, returnedCount, groups }) =>
      Effect.gen(function* () {
        const scenario = yield* scenarioOf({ storage: "temp-directory" });
        const { service, leases } = yield* harness(scenario);
        const inline = yield* service.query({ from: "items", ...params });
        const output = join(dirname(scenario.path), "grouped.json");

        const receipt = yield* json(
          service.query({ from: "items", ...params, output }),
        );

        const saved = yield* readText(output);
        expect(saved).toBe(inline);
        expect(
          (JSON.parse(saved) as { groups: unknown[] }).groups,
        ).toHaveLength(groups);
        expect(receipt).toMatchObject({
          ok: true,
          totalCount,
          returnedCount,
          file: {
            path: output,
            bytes: Buffer.byteLength(saved),
            format: "json",
          },
        });
        expect(receipt).not.toHaveProperty("groups");
        expect(receipt).not.toHaveProperty("rows");
        expect(leases()).toBe(0);
      }),
  );

  it.effect(
    "asks for an output file with CSV and TSV, and names the formats it writes",
    () =>
      Effect.gen(function* () {
        const scenario = yield* scenarioOf({ storage: "temp-directory" });
        const { service, leases } = yield* harness(scenario);
        expect(
          yield* json(service.query({ from: "items", format: "csv" })),
        ).toMatchObject({
          ok: false,
          diagnostic: {
            code: "invalid-argument",
            message: expect.stringContaining("add output=<absolute-path>"),
            details: { parameter: "format" },
          },
        });
        const output = join(dirname(scenario.path), "items.xlsx");
        expect(
          yield* json(service.query({ from: "items", format: "xlsx", output })),
        ).toMatchObject({
          ok: false,
          diagnostic: {
            code: "invalid-argument",
            message:
              "format 'xlsx' is not an output format: use json, csv, tsv.",
            details: { parameter: "format" },
          },
        });
        expect(yield* files(dirname(output))).not.toContain("items.xlsx");
        expect(
          yield* json(service.query({ from: "items", format: "json" })),
        ).toMatchObject({ ok: true });
        expect(leases()).toBe(0);
      }),
  );

  it.effect(
    "bounds inline replies and exports every row of a large result",
    () =>
      Effect.gen(function* () {
        const scenario = yield* scenarioOf({ storage: "temp-directory" });
        seedBulkLibrary(scenario.sqlite, 6000);
        const { service } = yield* harness(scenario);
        expect(
          yield* json(service.query({ from: "items", ...bulk })),
        ).toMatchObject({
          diagnostic: { code: "result-too-large" },
        });
        const output = join(dirname(scenario.path), "large.json");
        const receipt = yield* json(
          service.query({ from: "items", ...bulk, output }),
        );
        const text = yield* readText(output);
        expect(receipt).toMatchObject({
          ok: true,
          returnedCount: 6000,
          warnings: [],
          file: { bytes: Buffer.byteLength(text) },
        });
        expect(JSON.parse(text).rows).toHaveLength(6000);
        const csvOutput = join(dirname(scenario.path), "large.csv");
        expect(
          yield* json(
            service.query({
              from: "items",
              ...bulk,
              format: "csv",
              output: csvOutput,
            }),
          ),
        ).toMatchObject({
          ok: true,
          returnedCount: 6000,
          file: { format: "csv" },
        });
        const csvLines = (yield* readText(csvOutput)).split("\r\n");
        expect(csvLines).toHaveLength(6002);
        expect(csvLines.at(-1)).toBe("");
        expect(JSON.parse(text)).toMatchObject({
          ok: true,
          returnedCount: 6000,
          truncated: false,
          warnings: [],
        });
      }),
  );

  it.effect(
    "stops an inline query above the limit early, and ends its borrow",
    () =>
      Effect.gen(function* () {
        const scenario = yield* scenarioOf({ storage: "temp-directory" });
        seedBulkLibrary(scenario.sqlite, 20000);
        let sent = 0;
        const counted: QueryJobRunner = {
          ...queryJobRunner,
          answer: (job, read) =>
            queryJobRunner.answer(job, read).pipe(
              Stream.tap((part) =>
                Effect.sync(() => {
                  if (part._tag === "Chunk") sent += part.bytes.byteLength;
                }),
              ),
            ),
        };
        const { service, leases, answerOptions, borrowsReleased, borrowed } =
          yield* harness(scenario, sharedClientOpener(scenario.db), counted);
        expect(
          yield* json(service.query({ from: "items", ...bulk })),
        ).toMatchObject({
          ok: false,
          diagnostic: {
            code: "result-too-large",
            hint: "Run the query with output=<absolute-path> to write the complete response to a new JSON file, or reduce the fields or limit.",
          },
        });
        expect(leases()).toBe(0);
        expect(borrowed()).toBeGreaterThan(0);
        yield* borrowsReleased;
        expect(answerOptions()).toEqual([
          expect.objectContaining({ streamBufferSize: 0 }),
        ]);
        const stopped = sent;
        const output = join(dirname(scenario.path), "complete.json");
        yield* service.query({ from: "items", ...bulk, output });
        const complete = Buffer.byteLength(yield* readText(output));
        expect(stopped).toBeGreaterThan(1024 * 1024);
        expect(stopped).toBeLessThanOrEqual(1024 * 1024 + 2 * 256 * 1024);
        expect(complete).toBeGreaterThan(2 * stopped);
      }),
  );

  it.effect(
    "bounds a listing of zotlit:query-values and gives a recovery action for this command",
    () =>
      Effect.gen(function* () {
        const scenario = yield* scenarioOf({ storage: "temp-directory" });
        scenario.sqlite
          .prepare(
            "insert into collections (collectionName, libraryID, key) values (?, 1, 'HUGECL22')",
          )
          .run("a".repeat(1024 * 1024));
        const { service, leases } = yield* harness(scenario);
        const result = yield* json(
          service.values({ kind: "collections", limit: "all" }),
        );
        expect(result).toMatchObject({
          ok: false,
          diagnostic: { code: "result-too-large" },
        });
        expect(result.diagnostic.hint).toBe(
          RESULT_TOO_LARGE_HINTS[QUERY_VALUES_COMMAND],
        );
        expect(result.diagnostic.report.at(-1)).toBe(result.diagnostic.hint);
        expect(leases()).toBe(0);
      }),
  );

  it.effect(
    "gives the measure command the Worker measurement of a query that fails and of a result above the inline limit",
    () =>
      Effect.gen(function* () {
        const scenario = yield* scenarioOf({ storage: "temp-directory" });
        seedBulkLibrary(scenario.sqlite, 6000);
        const { service } = yield* harness(scenario);
        const measured = (params: CliData) =>
          Effect.gen(function* () {
            const measurements: WorkerMeasurement[] = [];
            const answer = yield* json(
              service.measure(params, {
                heap: false,
                completed: (measurement) => measurements.push(measurement),
              }),
            );
            return { answer, measurements };
          });

        const failed = yield* measured({ fields: '["notAField"]' });
        const tooLarge = yield* measured({ from: "items", ...bulk });

        expect(failed.answer).toMatchObject({
          ok: false,
          diagnostic: { code: "unknown-field" },
        });
        expect(failed.measurements).toEqual([
          expect.objectContaining({ workerMs: expect.any(Number) }),
        ]);
        expect(tooLarge.answer).toMatchObject({
          ok: false,
          diagnostic: { code: "result-too-large" },
        });
        expect(tooLarge.measurements).toEqual([
          expect.objectContaining({ workerMs: expect.any(Number) }),
        ]);
      }),
  );

  it.effect(
    "cancels a queued export at once, and starts no borrow for it",
    () => {
      const release = Deferred.makeUnsafe<void>();
      return Effect.gen(function* () {
        const scenario = yield* scenarioOf({ storage: "temp-directory" });
        seedBulkLibrary(scenario.sqlite, 1);
        const holding = yield* Queue.unbounded<void>();
        const held: QueryJobRunner = {
          ...queryJobRunner,
          answer: (job, read) =>
            Stream.unwrap(
              Effect.as(
                Queue.offer(holding, undefined),
                queryJobRunner
                  .answer(job, read)
                  .pipe(Stream.tap(() => Deferred.await(release))),
              ),
            ),
        };
        const { service, leases, borrowed } = yield* harness(
          scenario,
          sharedClientOpener(scenario.db),
          held,
        );
        const directory = dirname(scenario.path);
        const exportTo = (id: string) =>
          started(
            service.query({
              from: "items",
              ...bulk,
              id,
              output: join(directory, `${id}.json`),
            }),
          );
        const first = yield* exportTo("first");
        const second = yield* exportTo("second");
        yield* Queue.take(holding);
        yield* Queue.take(holding);
        const borrowsWithSlotsHeld = borrowed();
        const queued = yield* exportTo("queued");
        yield* Effect.promise(() =>
          vi.waitFor(() => expect(leases()).toBe(3), {
            timeout: 15000,
            interval: 1,
          }),
        );

        expect(yield* service.cancel("queued")).toBe(true);
        yield* Effect.promise(() =>
          vi.waitFor(() => expect(queued.pollUnsafe()).toBeDefined(), {
            timeout: 2000,
            interval: 1,
          }),
        );

        expect(yield* Effect.flip(Fiber.join(queued))).toMatchObject({
          _tag: "QueryCancelled",
          message: queryCancelledText("queued"),
        });
        expect(borrowed()).toBe(borrowsWithSlotsHeld);
        expect(first.pollUnsafe()).toBeUndefined();
        expect(second.pollUnsafe()).toBeUndefined();
        yield* Deferred.succeed(release, undefined);
        expect(JSON.parse(yield* Fiber.join(first)).ok).toBe(true);
        expect(JSON.parse(yield* Fiber.join(second)).ok).toBe(true);
        expect(borrowed()).toBe(borrowsWithSlotsHeld);
        expect(temporary(yield* files(directory))).toEqual([]);
      }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)));
    },
  );

  it.effect(
    "cancels an export and a queued job, lets another query finish, and recovers a worker",
    () =>
      Effect.gen(function* () {
        const scenario = yield* scenarioOf({ storage: "temp-directory" });
        seedBulkLibrary(scenario.sqlite, 20000);
        const { service, leases } = yield* harness(scenario);
        const output = join(dirname(scenario.path), "cancelled.json");
        const running = yield* started(
          service.query({ from: "items", ...bulk, output }),
        );
        const other = yield* started(
          service.query({ from: "items", ...bulk, fields: "[]", limit: "100" }),
        );
        const waiting = yield* started(
          service.query({ from: "items", limit: "1" }),
        );
        yield* nextTurn;
        yield* Fiber.interrupt(waiting);
        expect(interruptedOnly(yield* Fiber.await(waiting))).toBe(true);
        yield* exportStarted(dirname(output));

        yield* Fiber.interrupt(running);

        expect(interruptedOnly(yield* Fiber.await(running))).toBe(true);
        expect(JSON.parse(yield* Fiber.join(other)).ok).toBe(true);
        expect(leases()).toBe(0);
        const names = yield* files(dirname(output));
        expect(names).not.toContain("cancelled.json");
        expect(temporary(names)).toEqual([]);
        expect(
          yield* json(service.query({ from: "items", limit: "1" })),
        ).toMatchObject({ ok: true, returnedCount: 1 });
      }),
  );

  it.effect(
    "cancels a named export while it writes rows, and leaves other queries running",
    () =>
      Effect.gen(function* () {
        const scenario = yield* scenarioOf({ storage: "temp-directory" });
        seedBulkLibrary(scenario.sqlite, 20000);
        const { service, leases } = yield* harness(scenario);
        const output = join(dirname(scenario.path), "named.json");
        const running = yield* started(
          service.query({ from: "items", ...bulk, id: "export", output }),
        );
        const other = yield* started(
          service.query({ from: "items", ...bulk, id: "other", limit: "100" }),
        );
        const unnamed = yield* started(
          service.query({ from: "items", ...bulk, limit: "100" }),
        );
        yield* exportStarted(dirname(output));

        expect(yield* service.cancel("export")).toBe(true);
        expect(yield* Effect.flip(Fiber.join(running))).toMatchObject({
          _tag: "QueryCancelled",
          message: queryCancelledText("export"),
        });

        expect(JSON.parse(yield* Fiber.join(other))).toMatchObject({
          ok: true,
        });
        expect(JSON.parse(yield* Fiber.join(unnamed))).toMatchObject({
          ok: true,
        });
        expect(leases()).toBe(0);
        const names = yield* files(dirname(output));
        expect(names).not.toContain("named.json");
        expect(temporary(names)).toEqual([]);
        expect(yield* service.cancel("export")).toBe(false);
        expect(yield* service.cancel("other")).toBe(false);
        expect(yield* service.runningJobs).toBe(0);
        expect(
          yield* json(
            service.query({ from: "items", id: "export", limit: "1" }),
          ),
        ).toMatchObject({ ok: true, returnedCount: 1 });
      }),
  );

  it.effect("cancels a running inline query by its id and frees the id", () =>
    Effect.gen(function* () {
      const scenario = yield* scenarioOf({ storage: "temp-directory" });
      seedBulkLibrary(scenario.sqlite, 20000);
      const { service, leases, jobs } = yield* harness(scenario);
      const running = yield* started(
        service.query({ from: "items", ...bulk, fields: "[]", id: "inline" }),
      );
      yield* Effect.promise(() =>
        vi.waitFor(() => expect(leases()).toBe(1), {
          timeout: 15000,
          interval: 1,
        }),
      );

      expect(yield* service.cancel("inline")).toBe(true);
      expect(yield* Effect.flip(Fiber.join(running))).toMatchObject({
        _tag: "QueryCancelled",
        message: queryCancelledText("inline"),
      });

      expect(jobs()).toHaveLength(1);
      expect(leases()).toBe(0);
      expect(yield* service.cancel("inline")).toBe(false);
      expect(yield* service.runningJobs).toBe(0);
      expect(
        yield* json(service.query({ from: "items", id: "inline", limit: "1" })),
      ).toMatchObject({ ok: true, returnedCount: 1 });
    }),
  );

  it.effect(
    "frees the ID of a query that fails, and of a request that is invalid",
    () =>
      Effect.gen(function* () {
        const scenario = yield* scenarioOf({ storage: "temp-directory" });
        const { service, leases } = yield* harness(scenario);
        expect(
          yield* json(
            service.query({
              from: "items",
              id: "job",
              fields: '["notAField"]',
            }),
          ),
        ).toMatchObject({ diagnostic: { code: "unknown-field" } });
        expect(
          yield* json(service.query({ from: "items", id: "job", limit: "0" })),
        ).toMatchObject({ diagnostic: { code: "invalid-argument" } });
        const missing = join(dirname(scenario.path), "missing", "items.json");
        expect(
          yield* json(
            service.query({ from: "items", id: "job", output: missing }),
          ),
        ).toMatchObject({ diagnostic: { code: "output-error" } });
        expect(yield* service.cancel("job")).toBe(false);
        expect(yield* service.runningJobs).toBe(0);
        expect(
          yield* json(service.query({ from: "items", id: "job", limit: "1" })),
        ).toMatchObject({ ok: true });
        expect(leases()).toBe(0);
      }),
  );

  it.effect(
    "settles each race of completion and cancel with one outcome and a free ID",
    () =>
      Effect.gen(function* () {
        const scenario = yield* scenarioOf({ storage: "temp-directory" });
        const { service, leases } = yield* harness(scenario);
        const outcomes = new Set<string>();
        for (const turns of [0, 1, 2, 4, 8, 16, 32, 64, 128, 256]) {
          if (outcomes.has("answered")) break;
          const output = join(dirname(scenario.path), `race-${turns}.json`);
          const running = yield* started(
            service.query({ from: "items", id: "race", limit: "all", output }),
          );
          for (let turn = 0; turn < turns; turn++) yield* nextTurn;
          const requested = yield* service.cancel("race");
          const settled = yield* Fiber.await(running);
          expect(yield* service.cancel("race")).toBe(false);
          expect(yield* service.runningJobs).toBe(0);
          expect(leases()).toBe(0);
          const names = yield* files(dirname(output));
          expect(temporary(names)).toEqual([]);
          const published = names.includes(`race-${turns}.json`);
          if (Exit.isSuccess(settled)) {
            expect({
              ok: (JSON.parse(settled.value) as { ok: boolean }).ok,
              published,
            }).toEqual({ ok: true, published: true });
            outcomes.add("answered");
          } else {
            expect({
              requested,
              error: Cause.squash(settled.cause),
              published,
            }).toMatchObject({
              requested: true,
              error: {
                _tag: "QueryCancelled",
                message: queryCancelledText("race"),
              },
              published: false,
            });
            outcomes.add("cancelled");
          }
        }
        expect([...outcomes].toSorted()).toEqual(["answered", "cancelled"]);
      }),
  );

  it.effect("keeps the query of another vault with the same ID running", () =>
    Effect.gen(function* () {
      const scenario = yield* scenarioOf({ storage: "temp-directory" });
      seedBulkLibrary(scenario.sqlite, 6000);
      const first = yield* harness(scenario);
      const second = yield* harness(scenario);
      const output = join(dirname(scenario.path), "second.json");
      const cancelled = yield* started(
        first.service.query({ from: "items", ...bulk, id: "job" }),
      );
      const kept = yield* started(
        second.service.query({ from: "items", ...bulk, id: "job", output }),
      );

      expect(yield* first.service.cancel("job")).toBe(true);
      expect(yield* Effect.flip(Fiber.join(cancelled))).toMatchObject({
        _tag: "QueryCancelled",
        message: queryCancelledText("job"),
      });

      expect(JSON.parse(yield* Fiber.join(kept))).toMatchObject({
        ok: true,
        returnedCount: 6000,
      });
    }),
  );

  it.effect("cancels every named query on unload and frees their IDs", () =>
    Effect.gen(function* () {
      const scenario = yield* scenarioOf({ storage: "temp-directory" });
      seedBulkLibrary(scenario.sqlite, 2000);
      const { service, leases, unload } = yield* harness(scenario);
      const runs = yield* Effect.forEach(["a", "b", "c"], (id) =>
        started(service.query({ from: "items", ...bulk, id })),
      );

      yield* unload;

      for (const run of runs)
        expect(yield* Effect.flip(Fiber.join(run))).toMatchObject({
          _tag: "QueryCancelled",
          message: "The query was cancelled.",
        });
      expect(leases()).toBe(0);
      for (const id of ["a", "b", "c"])
        expect(yield* service.cancel(id)).toBe(false);
    }),
  );

  it.effect(
    "unloads after active jobs release their connections and leases",
    () =>
      Effect.gen(function* () {
        const scenario = yield* scenarioOf({ storage: "temp-directory" });
        seedBulkLibrary(scenario.sqlite, 2000);
        const { service, leases, unload } = yield* harness(scenario);
        const running = yield* started(
          service.query({ from: "items", ...bulk }),
        );

        yield* unload;

        expect(yield* Effect.flip(Fiber.join(running))).toMatchObject({
          _tag: "QueryCancelled",
          message: "The query was cancelled.",
        });
        expect(leases()).toBe(0);
        expect(yield* service.runningJobs).toBe(0);
        expect(
          yield* Effect.flip(service.query({ from: "items" })),
        ).toMatchObject({
          _tag: "QueryCancelled",
          message: "The query was cancelled.",
        });
      }),
  );

  it.effect(
    "answers query-id-in-use to one of two calls that claim one id at once",
    () =>
      Effect.gen(function* () {
        const scenario = yield* scenarioOf({ storage: "temp-directory" });
        const { service, leases } = yield* harness(scenario);
        const call = json(
          service.query({ from: "items", id: "same", limit: "1" }),
        );

        const answers = (yield* Effect.all([call, call], {
          concurrency: "unbounded",
        })) as { ok: boolean }[];

        expect(answers.filter((answer) => answer.ok)).toHaveLength(1);
        expect(answers.find((answer) => !answer.ok)).toMatchObject({
          diagnostic: { code: "query-id-in-use" },
        });
        expect(leases()).toBe(0);
      }),
  );
});

it.effect(
  "resolves the file of each Attachment that an Annotation Query projects",
  () =>
    Effect.gen(function* () {
      const scenario = yield* scenarioOf({
        storage: "temp-directory",
        annotations: true,
      });
      const { service, leases } = yield* harness(scenario);
      const directory = join(dirname(scenario.path), "storage", "PDF2LIVE");
      yield* Effect.promise(() => mkdir(directory, { recursive: true }));
      yield* Effect.promise(() =>
        writeFile(join(directory, "exact.pdf"), "fixture"),
      );
      const result = yield* json(
        service.query({
          from: "annotations",
          filter: 'item.indexedKey == "ART2FULL"',
          limit: "all",
        }),
      );
      expect(
        result.rows.find(
          (row: { indexedKey: string }) => row.indexedKey === "ANN2HGHT",
        ).values.attachment,
      ).toMatchObject({ path: join(directory, "exact.pdf"), exists: true });
      expect(leases()).toBe(0);
    }),
);

it.effect.each([
  ['type == "image" AND hasExcerptImage', "invalid-filter", "AND"],
  ['pageLable == "1"', "unknown-field", "pageLable"],
  ['item.Title == "paper"', "unknown-field", "item.Title"],
  ['item.creators.lastName == "Hopper"', "unknown-property", "lastName"],
  ["text.contains(1)", "wrong-argument-type", "1"],
  [
    'item.custom["reviewStatus"] == "done"',
    "unknown-field",
    'item.custom["reviewStatus"]',
  ],
] as const)(
  "renders Annotation filter faults through the worker: %s",
  ([filter, code, at]) =>
    Effect.gen(function* () {
      const { service } = yield* harness(
        yield* scenarioOf({ annotations: true }),
      );
      const result = yield* json(
        service.query({ from: "annotations", filter }),
      );
      expect(result).toMatchObject({
        contractVersion: 4,
        command: "zotlit:query",
        ok: false,
        diagnostic: {
          code,
          severity: "error",
          location: { argument: "filter" },
          excerpt: { at },
        },
      });
      expect(result.diagnostic.report[0]).toBe(result.diagnostic.message);
      expect(result.diagnostic.report.at(-1)).toBe(result.diagnostic.hint);
    }),
);

it.effect(
  "writes Annotation warnings before rows in inline and exported results",
  () =>
    Effect.gen(function* () {
      const scenario = yield* scenarioOf({
        storage: "temp-directory",
        annotations: true,
      });
      const { service } = yield* harness(scenario);
      const params = { filter: 'item.date.year == "2014"' };
      const inline = yield* service.query({ from: "annotations", ...params });
      expect(JSON.parse(inline)).toMatchObject({
        warnings: [
          { code: "never-true", suggestions: ["item.date.year == 2014"] },
        ],
        returnedCount: 0,
        rows: [],
      });
      expect(inline.indexOf('"warnings"')).toBeLessThan(
        inline.indexOf('"rows"'),
      );
      const output = join(dirname(scenario.path), "warning-annotations.json");
      yield* service.query({ from: "annotations", ...params, output });
      expect(yield* readText(output)).toBe(inline);
    }),
);

it.effect.each([
  [{ fields: '["pageLable"]' }, "fields[0]", "fields='[\"pageLabel\"]'"],
  [{ fields: '["item.Title"]' }, "fields[0]", "fields='[\"item.title\"]'"],
  [
    { fields: JSON.stringify(['item.custom["Review.Status"]']) },
    "fields[0]",
    'fields=\'["item.custom[\\"review.status\\"]"]\'',
  ],
  [
    { sort: '[{"field":"pageIndx","direction":"asc"}]' },
    "sort[0].field",
    'sort=\'[{"field":"pageIndex","direction":"asc"}]\'',
  ],
] as const)(
  "corrects Annotation request names in their JSON arguments: %j",
  ([params, path, suggestion]) =>
    Effect.gen(function* () {
      const { service } = yield* harness(
        yield* scenarioOf({ annotations: true }),
      );
      expect(
        yield* json(service.query({ from: "annotations", ...params })),
      ).toMatchObject({
        ok: false,
        diagnostic: { location: { path }, suggestions: [suggestion] },
      });
    }),
);

it.effect("describes all three Query Datasets once when from is omitted", () =>
  Effect.gen(function* () {
    const { service } = yield* harness(
      yield* scenarioOf({ storage: "temp-directory", annotations: true }),
    );
    const result = yield* json(service.schema({}));
    expect(result).toMatchObject({
      contractVersion: 4,
      command: "zotlit:query-schema",
      ok: true,
    });
    expect(Object.keys(result.defaults)).toEqual([
      "items",
      "attachments",
      "annotations",
    ]);
    expect(Object.keys(result.datasets)).toEqual([
      "items",
      "attachments",
      "annotations",
    ]);
    expect(
      result.customFields.filter(
        (field: { name: string }) => field.name === "review.status",
      ),
    ).toHaveLength(1);
    const selected = yield* json(service.schema({ from: "annotations" }));
    expect(Object.keys(selected.defaults)).toEqual(["annotations"]);
    expect(Object.keys(selected.datasets)).toEqual(["annotations"]);
    expect(selected.datasets.annotations.fields).toContain("item.title");
  }),
);

it.effect(
  "names the custom fields of the active source for the expression editors",
  () =>
    Effect.gen(function* () {
      const { service } = yield* harness(
        yield* scenarioOf({ storage: "temp-directory", annotations: true }),
      );
      expect(yield* service.customFieldNames).toContain("review.status");
    }),
);

it.effect(
  "returns Attachment rows and narrows the live schema to Attachments",
  () =>
    Effect.gen(function* () {
      const { service } = yield* harness(
        yield* scenarioOf({ storage: "temp-directory", annotations: true }),
      );
      expect(
        yield* json(
          service.query({
            from: "attachments",
            filter: 'linkMode == "linked_file" && !exists',
            fields: "title,library,item.title",
          }),
        ),
      ).toMatchObject({
        ok: true,
        request: { from: "attachments" },
        returnedCount: 1,
        rows: [
          {
            indexedKey: "PDF2LINK",
            itemIndexedKey: "ART2FULL",
            values: {
              title: "linkedAttachment",
              library: "personal",
              "item.title": "Exact Matching in Literature Review",
            },
          },
        ],
      });
      const schema = yield* json(service.schema({ from: "attachments" }));
      expect(Object.keys(schema.datasets)).toEqual(["attachments"]);
      expect(Object.keys(schema.defaults)).toEqual(["attachments"]);
      expect(schema.datasets.attachments).toMatchObject({
        customPrefix: "item.",
      });
      expect(schema.defaults.attachments.fields).toEqual([
        "title",
        "contentType",
        "linkMode",
        "path",
        "exists",
        "item.title",
        "item.citationKey",
      ]);
    }),
);

it.effect(
  "discovers Collection values through the query worker and reports invalid arguments",
  () =>
    Effect.gen(function* () {
      const { service } = yield* harness(yield* scenarioOf());
      expect(
        yield* json(service.values({ kind: "collections", match: "thesis" })),
      ).toMatchObject({
        contractVersion: 4,
        command: "zotlit:query-values",
        ok: true,
        identity: { source: { id: "captured-source" } },
        values: [{ library: "personal", values: ["Thesis", "Thesis/Methods"] }],
      });
      const invalid = yield* json(service.values({}));
      expect(invalid).toMatchObject({
        ok: false,
        diagnostic: {
          code: "invalid-argument",
          details: { parameter: "kind" },
        },
      });
      expect(invalid.diagnostic.report.at(-1)).toBe(invalid.diagnostic.hint);
    }),
);

const bulkLibraries = {
  mode: "selected",
  libraries: [{ type: "group", groupID: BULK_LIBRARY.groupID }],
} as const;

describe("typed Query View call", () => {
  it.effect(
    "returns every matching row with no default limit and no size cap",
    () =>
      Effect.gen(function* () {
        const scenario = yield* scenarioOf({ storage: "temp-directory" });
        seedBulkLibrary(scenario.sqlite, 6000);
        const { service, leases } = yield* harness(scenario);

        const outcome = yield* service.run({
          from: "items",
          libraries: bulkLibraries,
          fields: ["title", "tags", "dateModified"],
        });

        if (outcome.kind !== "result") throw new Error(outcome.kind);
        const { result } = outcome;
        expect(result).toMatchObject({ returnedCount: 6000, truncated: false });
        expect(result.groups).toBeUndefined();
        expect(result.rows).toHaveLength(6000);
        expect(result.rows?.[0]).toEqual({
          indexedKey: `${bulkItemKey(5999)}g${BULK_LIBRARY.groupID}`,
          values: {
            title: "Bulk item 05999",
            tags: [{ name: "bulk", type: "manual" }],
            dateModified: "2021-01-01T01:39:59Z",
          },
        });
        expect(leases()).toBe(0);
      }),
  );

  it.effect("counts every match beside the rows that a limit returns", () =>
    Effect.gen(function* () {
      const scenario = yield* scenarioOf({ storage: "temp-directory" });
      seedBulkLibrary(scenario.sqlite, 300);
      const { service } = yield* harness(scenario);

      const outcome = yield* service.run({
        from: "items",
        libraries: bulkLibraries,
        fields: ["title"],
        filter: 'tags.contains("bulk-fifth")',
        limit: 7,
      });

      if (outcome.kind !== "result") throw new Error(outcome.kind);
      expect(outcome.result).toMatchObject({
        returnedCount: 7,
        matchedCount: 60,
        truncated: true,
      });
    }),
  );

  it.effect(
    "returns the groups with their value, their count and the total count",
    () =>
      Effect.gen(function* () {
        const scenario = yield* scenarioOf({ storage: "temp-directory" });
        seedBulkLibrary(scenario.sqlite, 300);
        const { service } = yield* harness(scenario);

        const outcome = yield* service.run({
          from: "items",
          libraries: bulkLibraries,
          fields: ["title"],
          sort: [{ field: "title", direction: "asc" }],
          group: "tags[].name",
          limit: 2,
        });

        if (outcome.kind !== "result") throw new Error(outcome.kind);
        const { result } = outcome;
        expect(result.rows).toBeUndefined();
        expect(result).toMatchObject({ totalCount: 300, truncated: true });
        expect(
          result.groups?.map(({ value, count, rows }) => ({
            value,
            count,
            titles: rows.map((row) => row.values.title),
          })),
        ).toEqual([
          {
            value: "bulk",
            count: 300,
            titles: ["Bulk item 00000", "Bulk item 00001"],
          },
          {
            value: "bulk-fifth",
            count: 60,
            titles: ["Bulk item 00000", "Bulk item 00005"],
          },
        ]);
      }),
  );

  it.effect("gives the diagnostic of zotlit:query as data", () =>
    Effect.gen(function* () {
      const scenario = yield* scenarioOf({ storage: "temp-directory" });
      const { service, leases } = yield* harness(scenario);
      const filter = 'titel == "Exact"';

      const outcome = yield* service.run({ from: "items", filter });
      const cli = yield* json(service.query({ from: "items", filter }));

      expect(cli.diagnostic).toMatchObject({
        code: "unknown-field",
        location: { argument: "filter" },
      });
      expect(outcome).toEqual({ kind: "failed", diagnostic: cli.diagnostic });
      expect(leases()).toBe(0);

      const unavailable = yield* harness(scenario, () => {
        throw new Error("source closed");
      });
      expect(yield* unavailable.service.run({ from: "items" })).toMatchObject({
        kind: "failed",
        diagnostic: { code: "source-unavailable" },
      });
    }),
  );

  it.effect("binds this to the Query Context of the request", () =>
    Effect.gen(function* () {
      const scenario = yield* scenarioOf({ storage: "temp-directory" });
      seedBulkLibrary(scenario.sqlite, 30);
      const { service } = yield* harness(scenario);
      const item = `${bulkItemKey(7)}g${BULK_LIBRARY.groupID}`;
      const request = {
        from: "items",
        libraries: bulkLibraries,
        fields: ["title"],
        filter: "indexedKey == this.item.indexedKey",
      } as const;

      const bound = yield* service.run({ ...request, context: { item } });
      const unbound = yield* service.run(request);

      expect(bound).toMatchObject({
        kind: "result",
        result: {
          returnedCount: 1,
          rows: [{ indexedKey: item, values: { title: "Bulk item 00007" } }],
        },
      });
      expect(unbound).toMatchObject({
        kind: "failed",
        diagnostic: { code: "unbound-context" },
      });
    }),
  );

  it.effect(
    "leaves out each wrong Formula with its Diagnostic, and gives no warning for an unread Formula",
    () =>
      Effect.gen(function* () {
        const scenario = yield* scenarioOf({ storage: "temp-directory" });
        seedBulkLibrary(scenario.sqlite, 3);
        const { service } = yield* harness(scenario);
        const request = {
          from: "items",
          libraries: bulkLibraries,
          fields: ["title", "formula.year", "formula.next", "formula.short"],
          formulas: {
            year: "dat.year",
            next: "formula.year + 1",
            short: "title.slice(0, 4)",
            unused: "title",
          },
        } as const;

        const outcome = yield* service.run(request);

        if (outcome.kind !== "result") throw new Error(outcome.kind);
        expect(outcome.result.returnedCount).toBe(3);
        expect(outcome.result.rows![0]!.values).toMatchObject({
          "formula.short": "Bulk",
        });
        expect(outcome.result.warnings).toEqual([]);
        expect(
          Object.fromEntries(
            Object.entries(outcome.result.formulaDiagnostics ?? {}).map(
              ([name, { code }]) => [name, code],
            ),
          ),
        ).toEqual({ year: "unknown-property", next: "reads-faulted-formula" });

        const filtered = yield* service.run({
          ...request,
          filter: "formula.next > 2000",
        });
        expect(filtered).toMatchObject({
          kind: "failed",
          diagnostic: {
            code: "reads-faulted-formula",
            message: "The filter reads formula.next, which has a mistake.",
            location: { argument: "filter" },
          },
          formulaDiagnostics: {
            year: { code: "unknown-property" },
            next: { code: "reads-faulted-formula" },
          },
        });
      }),
  );
});

describe("QueryHandle", () => {
  const request = {
    from: "items",
    libraries: bulkLibraries,
    fields: ["title", "tags", "dateModified"],
  } as const;

  async function handleOver(scenario: ScenarioDatabase<NodeDatabaseClient>) {
    await using stack = new AsyncDisposableStack();
    const { state, wrap } = counter();
    const reads = stack.use(
      inProcessReadsService(sharedClientOpener(scenario.db), {
        wrap,
        handlers: { queryJobs: queryJobRunner },
      }),
    );
    const { handle } = await buildQueryService(
      {
        reads: reads.reads,
        source: SOURCE(scenario),
        effective: () => MY_LIBRARY_SCOPE,
      },
      stack,
    );
    const owned = stack.move();
    return {
      handle,
      jobs: () => state.jobs,
      leases: () => state.leases,
      [Symbol.asyncDispose]: () => owned.disposeAsync(),
    };
  }

  it("stops an aborted call with a cancelled outcome and keeps other queries running", async () => {
    using scenario = openScenarioDatabase(connectClient, {
      storage: "temp-directory",
    });
    seedBulkLibrary(scenario.sqlite, 20000);
    await using h = await handleOver(scenario);
    const signal = () => new AbortController().signal;
    const cancel = new AbortController();
    const queued = new AbortController();

    const running = h.handle.run(request, cancel.signal);
    const other = h.handle.run({ ...request, limit: 100 }, signal());
    const waiting = h.handle.run({ ...request, limit: 1 }, queued.signal);
    await vi.waitFor(() => expect(h.jobs()).toHaveLength(3), { interval: 1 });
    queued.abort();
    cancel.abort();

    expect(await running).toEqual({ kind: "cancelled" });
    expect(await waiting).toEqual({ kind: "cancelled" });
    expect(await other).toMatchObject({
      kind: "result",
      result: { returnedCount: 100 },
    });
    expect(h.leases()).toBe(0);
    expect(h.handle.runningJobs).toBe(0);
    expect(
      await h.handle.run({ ...request, limit: 1 }, signal()),
    ).toMatchObject({ kind: "result", result: { returnedCount: 1 } });
  });

  it("answers a call after the unload with a cancelled outcome and no custom fields", async () => {
    using scenario = openScenarioDatabase(connectClient, {
      storage: "temp-directory",
    });
    const h = await handleOver(scenario);
    await h[Symbol.asyncDispose]();
    const signal = new AbortController().signal;

    expect(await h.handle.run(request, signal)).toEqual({ kind: "cancelled" });
    expect(await h.handle.customFieldNames(signal)).toEqual([]);
  });
});

it.effect("tells a Query View of a Use recorded after it subscribes", () =>
  Effect.gen(function* () {
    const ledger = yield* SubscriptionRef.make<Ledger>({});
    const layer = layerTestQueryService(
      {
        reads: readsAnswering({}),
        source: {
          sourceId: "captured-source",
          databasePath: "",
          dataDir: "",
          baseAttachmentPath: null,
        },
      },
      Layer.mock(UseLedger, { changes: SubscriptionRef.changes(ledger) }),
    );
    yield* Effect.gen(function* () {
      const service = yield* QueryService;
      const changed = yield* Effect.forkChild(Stream.runHead(service.changed), {
        startImmediately: true,
      });
      expect(changed.pollUnsafe()).toBeUndefined();

      yield* SubscriptionRef.set(ledger, {
        AAAAAAAB: { instant: DateTime.makeUnsafe(0), kind: "opened" },
      });
      expect(yield* Fiber.join(changed)).toEqual(Option.some(undefined));
    }).pipe(Effect.provide(layer));
  }),
);
