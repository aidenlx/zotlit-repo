import type {
  QueryFixture,
  QueryFixtureOptions,
} from "#__fixtures__/item-query.ts";
import type {
  QueryViewOutcome,
  QueryViewRequest,
} from "#worker/item-query/query-view.ts";
import type { WorkerMeasurement } from "#worker/item-query/trace.ts";
import { it } from "@effect/vitest";
import { Deferred, Effect, Exit, Fiber, Layer, Queue, Stream } from "effect";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { CliData } from "obsidian";
import { afterAll, beforeAll, describe, expect } from "vitest";

import type { NodeDatabaseClient } from "@zotlit/db/client/node";
import { PARITY_USER } from "@zotlit/db/replica/parity-pair";
import reports from "@zotlit/item-query/diagnostic-reports.json" with { type: "json" };
import { ItemMatchQuery } from "@zotlit/notes/core/profile-selection/item-matches.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { openScenarioApi } from "@zotlit/web-library/fake-zotero-api/scenario";
import type { ScenarioApi } from "@zotlit/web-library/fake-zotero-api/scenario";
import {
  seedItemKey,
  seedLibrary,
} from "@zotlit/web-library/fake-zotero-api/seed";
import {
  fileConfig,
  inProcessReadsService,
  sharedClientOpener,
} from "@zotlit/zotero-reads/__fixtures__/in-process.ts";
import { webApiReadsService } from "@zotlit/zotero-reads/__fixtures__/web-api-reads.ts";
import { fakeApiFetch } from "@zotlit/zotero-reads/__fixtures__/web-api.ts";
import type { ZoteroReadsApi } from "@zotlit/zotero-reads/client/service.ts";
import { MY_LIBRARY_SCOPE } from "@zotlit/zotero-reads/contract/library-scope.ts";

import { nodeExportFiles } from "./export-files-node.ts";
import { layerItemMatchQuery } from "./item-matches.ts";
import { queryJobRunner } from "./job.ts";
import { QueryService } from "./service.ts";

import { buildQueryService } from "#__fixtures__/item-query.ts";
import { searchAnnotations } from "#desktop/annotation-suggest/annotation-search.ts";
import {
  readerFailureText,
  readerWarningText,
} from "#obsidian/query-view/reader-failure.ts";
import { DIAGNOSTIC_HINTS } from "#worker/item-query/contract.ts";
import { makeQueryJobRunner } from "#worker/item-query/job.ts";

const SHELL_FORM = /zotlit:|[a-z][\w-]*='|[a-z][\w-]*=<|\blibrary=/;

interface Sources {
  readonly file: QueryFixture;
  readonly web: QueryFixture;
}

let sourceReads: Record<keyof Sources, ZoteroReadsApi>;
let build: (
  reads: ZoteroReadsApi,
  exportFiles?: QueryFixtureOptions["exportFiles"],
) => Promise<QueryFixture>;

let stack: AsyncDisposableStack;
let scenario: ScenarioApi;
let sources: Sources;

beforeAll(async () => {
  stack = new AsyncDisposableStack();
  scenario = stack.use(openScenarioApi());
  const desktop = scenario.pair.desktop;
  const source = {
    sourceId: "captured-source",
    databasePath: desktop.path,
    dataDir: dirname(desktop.path),
    baseAttachmentPath: join(dirname(desktop.path), "linked"),
  };
  const fileReads = stack.use(
    inProcessReadsService(
      sharedClientOpener(desktop.db as NodeDatabaseClient),
      {
        handlers: { queryJobs: queryJobRunner },
        config: fileConfig(desktop.path, source.sourceId),
      },
    ),
  );
  const webReads = stack.use(
    webApiReadsService(
      {
        api: scenario.api,
        key: scenario.key,
        fetch: fakeApiFetch(scenario.api),
      },
      { queryJobs: makeQueryJobRunner({ meter: {} }) },
    ),
  );
  build = (reads, exportFiles) =>
    buildQueryService(
      {
        reads,
        pluginVersion: "2.2.0-beta.2",
        source,
        effective: () => MY_LIBRARY_SCOPE,
        vaultName: "Online library",
        basePath: dirname(desktop.path),
        ...(exportFiles ? { exportFiles } : {}),
      },
      stack,
    );
  sources = {
    file: await build(fileReads.reads),
    web: await build(webReads.reads),
  };
  sourceReads = { file: fileReads.reads, web: webReads.reads };
});

afterAll(() => stack.disposeAsync());

const run = (fixture: QueryFixture, request: QueryViewRequest) =>
  fixture.handle.run(request, new AbortController().signal);

const rowCount = (outcome: QueryViewOutcome) =>
  outcome.kind === "result" ? (outcome.result.rows ?? []).length : -1;

const both = async <A>(read: (fixture: QueryFixture) => Promise<A>) => ({
  file: await read(sources.file),
  web: await read(sources.web),
});

describe("ZotLit Query over the online library", () => {
  it.effect(
    "answers zotlit:query, zotlit:query-values and zotlit:query-schema inline with the same pretty envelope for each source",
    () =>
      Effect.gen(function* () {
        const answers = ({ service }: QueryFixture) =>
          Effect.all([
            service.query({
              limit: "all",
              fields: '["title","creators","tags"]',
            }),
            service.query({ fields: '["notAField"]' }),
            service.query({ library: "group:999999" }),
            service.values({ kind: "tags", library: "all", limit: "all" }),
            service.schema({}),
          ]);
        const withoutIdentity = (text: string) => {
          const { identity: _, ...rest } = JSON.parse(text) as Record<
            string,
            unknown
          >;
          return rest;
        };
        const file = yield* answers(sources.file);
        const web = yield* answers(sources.web);

        for (const text of [...file, ...web])
          expect(text).toBe(JSON.stringify(JSON.parse(text), null, 2));
        expect(web.map((text) => withoutIdentity(text).ok)).toEqual([
          true,
          false,
          false,
          true,
          true,
        ]);
        expect(web.map(withoutIdentity)).toEqual(file.map(withoutIdentity));
      }),
  );

  it.effect(
    "names the online library, not the local Zotero database, as the source of its answer",
    () =>
      Effect.gen(function* () {
        const identityOf = (fixture: QueryFixture) =>
          Effect.map(
            fixture.service.query({ limit: "1" }),
            (text) =>
              (JSON.parse(text) as { identity: { source: unknown } }).identity
                .source,
          );
        expect(yield* identityOf(sources.web)).toEqual({
          kind: "web-api",
          id: `web-api:${PARITY_USER.userID}`,
          userID: PARITY_USER.userID,
          username: PARITY_USER.username,
        });
        expect(yield* identityOf(sources.file)).toEqual({
          kind: "file",
          id: "captured-source",
          databasePath: scenario.pair.desktop.path,
        });
      }),
  );

  it("gives a Query View the rows of the local Zotero database, by Indexed Key", async () => {
    const outcomes = await both((fixture) =>
      run(fixture, {
        from: "items",
        filter: "date.year >= 2000",
        fields: ["title", "date", "creators", "tags", "itemType"],
        sort: [{ field: "title", direction: "asc" }],
        libraries: { mode: "all" },
      }),
    );
    expect(rowCount(outcomes.web)).toBeGreaterThan(1);
    expect(outcomes.web).toEqual(outcomes.file);
  });

  it("gives the annotations dataset of the local Zotero database", async () => {
    const outcomes = await both((fixture) =>
      run(fixture, {
        from: "annotations",
        fields: ["type", "text", "comment", "color", "pageLabel", "tags"],
        sort: [{ field: "dateAdded", direction: "asc" }],
        libraries: { mode: "all" },
      }),
    );
    expect(rowCount(outcomes.web)).toBeGreaterThan(1);
    expect(outcomes.web).toEqual(outcomes.file);
  });

  it("finds the same annotations for the Annotation Suggester", async () => {
    const hits = await both(async (fixture) =>
      (await searchAnnotations(fixture.handle, "a", {
        signal: new AbortController().signal,
        limit: 50,
      }))!.map((hit) => hit.key),
    );
    expect(hits.web).toEqual(["ANN2LINK", "ANN2HGHT", "ANN2UNDR"]);
    expect(hits.web).toEqual(hits.file);
  });

  it.effect("tests the Profile Matches of a literature note", () =>
    Effect.gen(function* () {
      const matchesOf = (fixture: QueryFixture) =>
        Effect.gen(function* () {
          const query = yield* ItemMatchQuery;
          const result = yield* query.matches(
            [
              { key: "ART2FULL", groupID: null },
              { key: "BK2MNTH2", groupID: null },
            ],
            ['itemType == "book"', "date.year >= 2020"],
          );
          return result.kind === "result"
            ? Object.fromEntries(
                [...result.byKey].map(([key, { matched }]) => [key, matched]),
              )
            : result;
        }).pipe(
          Effect.provide(
            layerItemMatchQuery.pipe(
              Layer.provide(Layer.succeed(QueryService, fixture.service)),
            ),
          ),
        );
      const web = yield* matchesOf(sources.web);
      expect(web).toEqual({
        ART2FULL: [false, true],
        BK2MNTH2: [true, false],
      });
      expect(web).toEqual(yield* matchesOf(sources.file));
    }),
  );

  it("lists the custom field names of the local Zotero database", async () => {
    const names = await both((fixture) =>
      fixture.handle.customFieldNames(new AbortController().signal),
    );
    expect(names).toEqual({ file: [], web: [] });
  });

  it("reports each attachment file as absent", async () => {
    const outcome = await run(sources.web, {
      from: "attachments",
      fields: ["path", "exists"],
      libraries: { mode: "all" },
    });
    if (outcome.kind !== "result") throw new Error(outcome.kind);
    const rows = outcome.result.rows ?? [];
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map((row) => row.values.exists))).toEqual(
      new Set([false]),
    );
  });

  const exportFolder = Effect.acquireRelease(
    Effect.promise(() => mkdtemp(join(tmpdir(), "zotlit-online-"))),
    (path) => Effect.promise(() => rm(path, { recursive: true, force: true })),
  );
  const names = (folder: string) =>
    Effect.promise(async () => (await readdir(folder)).sort());
  const bytesOf = (path: string) => Effect.promise(() => readFile(path));
  const EXPORTED = { limit: "all", fields: '["title","creators","tags"]' };

  it.effect(
    "the online library writes the same file as the Zotero file source",
    () =>
      Effect.gen(function* () {
        const folder = yield* exportFolder;
        const written: Record<string, Record<keyof Sources, Uint8Array>> = {};
        for (const format of ["json", "csv", "tsv"] as const) {
          const files = {} as Record<keyof Sources, Uint8Array>;
          for (const name of ["file", "web"] as const) {
            const output = join(folder, `${name}.${format}`);
            const receipt = JSON.parse(
              yield* sources[name].service.query({
                ...EXPORTED,
                format,
                output,
              }),
            ) as Record<string, unknown>;
            files[name] = yield* bytesOf(output);
            expect(receipt).toMatchObject({
              ok: true,
              file: { path: output, bytes: files[name].byteLength, format },
            });
            expect(receipt).not.toHaveProperty("rows");
          }
          written[format] = files;
        }
        for (const format of ["csv", "tsv"])
          expect(Buffer.from(written[format]!.web)).toEqual(
            Buffer.from(written[format]!.file),
          );
        const withoutIdentity = (bytes: Uint8Array) => {
          const { identity: _, ...rest } = JSON.parse(
            Buffer.from(bytes).toString("utf8"),
          ) as Record<string, unknown>;
          return rest;
        };
        expect(withoutIdentity(written.json!.web)).toEqual(
          withoutIdentity(written.json!.file),
        );
        expect(Buffer.from(written.json!.web).toString("utf8")).toBe(
          yield* sources.web.service.query(EXPORTED),
        );
        expect(yield* names(folder)).toEqual(
          ["csv", "json", "tsv"]
            .flatMap((format) => [`file.${format}`, `web.${format}`])
            .sort(),
        );
      }).pipe(Effect.scoped),
  );

  it.effect.each(["file", "web"] as const)(
    "keeps an existing file, names a missing folder, and leaves no file for a failed query: %s",
    (name) =>
      Effect.gen(function* () {
        const { service } = sources[name];
        const folder = yield* exportFolder;
        const kept = join(folder, "kept.json");
        yield* Effect.promise(() => writeFile(kept, "keep this content"));
        const codeOf = (params: CliData) =>
          Effect.map(
            service.query(params),
            (text) =>
              (JSON.parse(text) as { diagnostic?: { code: string } }).diagnostic
                ?.code,
          );

        expect(yield* codeOf({ output: kept })).toBe("output-error");
        expect(Buffer.from(yield* bytesOf(kept)).toString("utf8")).toBe(
          "keep this content",
        );
        const missing = join(folder, "missing", "items.json");
        expect(yield* codeOf({ output: missing })).toBe("output-error");
        expect(
          yield* codeOf({ output: missing, fields: '["notAField"]' }),
        ).toBe("unknown-field");
        expect(
          yield* codeOf({
            output: join(folder, "failed.json"),
            fields: '["notAField"]',
          }),
        ).toBe("unknown-field");
        expect(yield* names(folder)).toEqual(["kept.json"]);
      }).pipe(Effect.scoped),
  );

  it.effect.each(["file", "web"] as const)(
    "cancels an export by its id before the commit and leaves no file, and gives the receipt to a cancel after the commit: %s",
    (name) =>
      Effect.gen(function* () {
        const folder = yield* exportFolder;
        const reads = sourceReads[name];
        const streaming = yield* Deferred.make<void>();
        const held: ZoteroReadsApi = {
          ...reads,
          QueryAnswer: ((
            payload: Parameters<ZoteroReadsApi["QueryAnswer"]>[0],
            options?: { readonly streamBufferSize?: number },
          ) =>
            reads
              .QueryAnswer(payload, options)
              .pipe(
                Stream.take(2),
                Stream.concat(
                  Stream.fromEffect(
                    Deferred.succeed(streaming, undefined),
                  ).pipe(Stream.drain),
                ),
                Stream.concat(Stream.never),
              )) as ZoteroReadsApi["QueryAnswer"],
        };
        const before = yield* Effect.promise(() => build(held));
        const running = yield* Effect.forkChild(
          before.service.query({
            ...EXPORTED,
            id: "export",
            output: join(folder, "cancelled.json"),
          }),
          { startImmediately: true },
        );
        yield* Deferred.await(streaming);
        expect(yield* names(folder)).toHaveLength(1);
        expect(yield* before.service.cancel("export")).toBe(true);
        const cancelled = yield* Fiber.await(running);
        expect(Exit.isFailure(cancelled)).toBe(true);
        expect(yield* names(folder)).toEqual([]);

        let late: QueryFixture | undefined;
        const after = yield* Effect.promise(() =>
          build(reads, (fs) => {
            const files = nodeExportFiles(fs);
            return {
              write: (path, document) =>
                Effect.tap(files.write(path, document), () =>
                  late!.service.cancel("late"),
                ),
            };
          }),
        );
        late = after;
        const output = join(folder, "late.json");
        const receipt = JSON.parse(
          yield* after.service.query({ ...EXPORTED, id: "late", output }),
        ) as { ok: boolean; file?: { bytes: number } };
        expect(receipt).toMatchObject({
          ok: true,
          file: { bytes: (yield* bytesOf(output)).byteLength },
        });
        expect(yield* names(folder)).toEqual(["late.json"]);
        expect(yield* after.service.cancel("late")).toBe(false);
      }).pipe(Effect.scoped),
  );

  it.effect(
    "answers export-unavailable on a device with no file capability, and sends no job",
    () =>
      Effect.gen(function* () {
        const folder = yield* exportFolder;
        let sent = 0;
        const reads = sourceReads.web;
        const counted: ZoteroReadsApi = {
          ...reads,
          QueryAnswer: ((
            payload: Parameters<ZoteroReadsApi["QueryAnswer"]>[0],
            options?: { readonly streamBufferSize?: number },
          ) =>
            Stream.unwrap(
              Effect.sync(() => {
                sent++;
                return reads.QueryAnswer(payload, options);
              }),
            )) as ZoteroReadsApi["QueryAnswer"],
        };
        const { service } = yield* Effect.promise(() =>
          build(counted, () => undefined),
        );
        expect(
          JSON.parse(
            yield* service.query({ output: join(folder, "online.json") }),
          ),
        ).toMatchObject({
          ok: false,
          diagnostic: {
            code: "export-unavailable",
            hint: DIAGNOSTIC_HINTS["export-unavailable"],
            details: { parameter: "output" },
          },
        });
        expect(sent).toBe(0);
        expect(yield* names(folder)).toEqual([]);
        expect(JSON.parse(yield* service.query({ limit: "1" }))).toMatchObject({
          ok: true,
        });
        expect(sent).toBe(1);
      }).pipe(Effect.scoped),
  );

  it.each([
    [
      "a library that the source does not hold",
      {
        from: "items",
        libraries: {
          mode: "selected",
          libraries: [{ type: "group", groupID: 999_999 }],
        },
      },
      "library-not-found",
    ],
    [
      "a filter that reads this.item with no bound Item",
      { from: "items", filter: "this.item == item" },
      "unbound-context",
    ],
    [
      "a field name with the wrong letter case",
      { from: "items", fields: ["title", "Date"] },
      "unknown-field",
    ],
  ] as const)(
    "gives a Query View the same failure for %s, with no command line hint",
    async (_name, request, code) => {
      const outcomes = await both((fixture) =>
        run(fixture, request as QueryViewRequest),
      );
      expect(outcomes.web).toEqual(outcomes.file);
      for (const outcome of [outcomes.file, outcomes.web]) {
        if (outcome.kind !== "failed") throw new Error(outcome.kind);
        expect(outcome.diagnostic.code).toBe(code);
        for (const state of ["loading", "ready", "degraded"] as const) {
          const text = readerFailureText(outcome.diagnostic, {
            state,
            dbFileMissing: false,
          });
          expect(text).not.toMatch(SHELL_FORM);
        }
      }
    },
  );

  it("gives a reader text with no command line form for each fault of the golden diagnostic reports", async () => {
    const requests = [
      ...reports.map(({ name, request, ...entry }) => ({
        name,
        request: {
          from: "dataset" in entry ? entry.dataset : "items",
          ...request,
        } as QueryViewRequest,
      })),
      {
        name: "a filter that reads an undefined formula",
        request: { from: "items", filter: "formula.year > 2000" },
      },
    ];
    const shown: { name: string; code: string; text: string }[] = [];
    for (const { name, request } of requests) {
      const outcome = await run(sources.file, request as QueryViewRequest);
      if (outcome.kind === "failed")
        shown.push({
          name,
          code: outcome.diagnostic.code,
          text: readerFailureText(outcome.diagnostic, {
            state: "ready",
            dbFileMissing: false,
          }),
        });
      if (outcome.kind === "result")
        for (const warning of outcome.result.warnings)
          shown.push({
            name,
            code: warning.code,
            text: readerWarningText(warning),
          });
    }
    expect(shown.length).toBeGreaterThan(70);
    expect(shown.filter(({ text }) => SHELL_FORM.test(text))).toEqual([]);
    expect(
      shown.find(
        ({ name }) => name === "a filter that reads an undefined formula",
      )?.text,
    ).toContain(
      m.query_view_failure_formula_undefined({
        name: "year",
        add: m.query_view_formula_add(),
      }),
    );
  });

  it.effect("measures an export and answers its receipt", () =>
    Effect.gen(function* () {
      const folder = yield* exportFolder;
      const output = join(folder, "measured.json");
      let measurement: WorkerMeasurement | undefined;
      const receipt = JSON.parse(
        yield* sources.web.service.measure(
          { limit: "5", output },
          {
            heap: false,
            completed: (report) => {
              measurement = report;
            },
          },
        ),
      ) as { ok: boolean; file?: { bytes: number } };
      expect(receipt).toMatchObject({
        ok: true,
        file: { bytes: (yield* bytesOf(output)).byteLength },
      });
      expect(measurement).toMatchObject({
        workerMs: expect.any(Number),
        engineMs: expect.any(Number),
      });
    }).pipe(Effect.scoped),
  );

  it.effect("measures a run with no heap figures", () =>
    Effect.gen(function* () {
      let measurement: WorkerMeasurement | undefined;
      const answer = JSON.parse(
        yield* sources.web.service.measure(
          { limit: "5" },
          {
            heap: true,
            completed: (report) => {
              measurement = report;
            },
          },
        ),
      ) as { ok: boolean };
      expect(answer.ok).toBe(true);
      expect(measurement).toMatchObject({
        workerMs: expect.any(Number),
        engineMs: expect.any(Number),
      });
      expect(measurement?.slices.length).toBeGreaterThan(0);
      expect(measurement).not.toHaveProperty("heap");
    }),
  );
});

describe("ZotLit Query over a large online library", () => {
  const ITEMS = 6000;
  const SEEDED = { filter: 'title.contains("Seeded study")' };
  const LARGE = { limit: "all", fields: '["title","tags"]' };
  let large: QueryFixture;
  let gate:
    | {
        readonly answered: Queue.Queue<void>;
        readonly release: Deferred.Deferred<void>;
      }
    | undefined;
  let subscribed: Queue.Queue<void> | undefined;
  let chunkHold:
    | {
        readonly reading: Deferred.Deferred<void>;
        readonly release: Deferred.Deferred<void>;
      }
    | undefined;

  beforeAll(async () => {
    const seeded = stack.use(openScenarioApi());
    seedLibrary(seeded.api.user, { items: ITEMS });
    const runner = makeQueryJobRunner({ meter: {} });
    const { reads } = stack.use(
      webApiReadsService(
        {
          api: seeded.api,
          key: seeded.key,
          fetch: fakeApiFetch(seeded.api),
        },
        {
          queryJobs: {
            ...runner,
            answer: (job, read) =>
              Stream.unwrap(
                Effect.sync(() => {
                  const held = gate;
                  if (held === undefined) return runner.answer(job, read);
                  Queue.offerUnsafe(held.answered, undefined);
                  return runner
                    .answer(job, read)
                    .pipe(Stream.tap(() => Deferred.await(held.release)));
                }),
              ),
          },
        },
      ),
    );
    const signalled: ZoteroReadsApi = {
      ...reads,
      QueryAnswer: ((
        payload: Parameters<ZoteroReadsApi["QueryAnswer"]>[0],
        options?: { readonly streamBufferSize?: number },
      ) =>
        Stream.unwrap(
          Effect.sync(() => {
            if (subscribed) Queue.offerUnsafe(subscribed, undefined);
            const held = chunkHold;
            const answer = reads.QueryAnswer(payload, options);
            const { job } = payload;
            if (held === undefined || !("query" in job) || !job.query?.export)
              return answer;
            let chunks = 0;
            return answer.pipe(
              Stream.tap((part) =>
                part._tag === "Chunk" && ++chunks === 2
                  ? Deferred.succeed(held.reading, undefined).pipe(
                      Effect.andThen(Deferred.await(held.release)),
                    )
                  : Effect.void,
              ),
            );
          }),
        )) as ZoteroReadsApi["QueryAnswer"],
    };
    large = await build(signalled);
  });

  const exportFolder = Effect.acquireRelease(
    Effect.promise(() => mkdtemp(join(tmpdir(), "zotlit-online-large-"))),
    (path) => Effect.promise(() => rm(path, { recursive: true, force: true })),
  );
  const names = (folder: string) =>
    Effect.promise(async () => (await readdir(folder)).sort());
  const started = <A, E>(call: Effect.Effect<A, E>) =>
    Effect.forkChild(call, { startImmediately: true });
  const holdSlots = Effect.gen(function* () {
    const held = {
      answered: yield* Queue.unbounded<void>(),
      release: yield* Deferred.make<void>(),
    };
    const requests = yield* Queue.unbounded<void>();
    gate = held;
    subscribed = requests;
    yield* Effect.addFinalizer(() =>
      Deferred.succeed(held.release, undefined).pipe(
        Effect.andThen(
          Effect.sync(() => {
            gate = undefined;
            subscribed = undefined;
          }),
        ),
      ),
    );
    return { ...held, requests };
  });

  it.effect(
    "bounds an inline answer and exports every row of a large result",
    () =>
      Effect.gen(function* () {
        const folder = yield* exportFolder;
        const seededKeys = Array.from({ length: ITEMS }, (_, index) =>
          seedItemKey(index),
        ).sort();
        expect(
          JSON.parse(yield* large.service.query({ ...LARGE, ...SEEDED })),
        ).toMatchObject({
          ok: false,
          diagnostic: { code: "result-too-large" },
        });
        const output = join(folder, "large.json");
        const receipt = JSON.parse(
          yield* large.service.query({ ...LARGE, ...SEEDED, output }),
        ) as { ok: boolean; returnedCount: number };
        const exported = JSON.parse(
          Buffer.from(yield* Effect.promise(() => readFile(output))).toString(
            "utf8",
          ),
        ) as { rows: { indexedKey: string }[] };
        expect(receipt).toMatchObject({
          ok: true,
          returnedCount: seededKeys.length,
        });
        expect(exported.rows.map((row) => row.indexedKey).sort()).toEqual(
          seededKeys,
        );
        expect(yield* names(folder)).toEqual(["large.json"]);
      }).pipe(Effect.scoped),
  );

  it.effect(
    "cancels a queued export at once, and starts no answer for it",
    () =>
      Effect.gen(function* () {
        const folder = yield* exportFolder;
        const held = yield* holdSlots;
        const exportTo = (id: string) =>
          started(
            large.service.query({
              ...LARGE,
              id,
              output: join(folder, `${id}.json`),
            }),
          );
        const first = yield* exportTo("first");
        const second = yield* exportTo("second");
        yield* Queue.take(held.answered);
        yield* Queue.take(held.answered);
        const queued = yield* exportTo("queued");
        yield* Queue.takeBetween(held.requests, 3, 3);

        expect(yield* large.service.cancel("queued")).toBe(true);
        const cancelled = yield* Fiber.await(queued);

        expect(Exit.isFailure(cancelled)).toBe(true);
        expect(yield* Queue.size(held.answered)).toBe(0);
        yield* Deferred.succeed(held.release, undefined);
        expect(JSON.parse(yield* Fiber.join(first)).ok).toBe(true);
        expect(JSON.parse(yield* Fiber.join(second)).ok).toBe(true);
        expect(yield* Queue.size(held.answered)).toBe(0);
        expect(yield* names(folder)).toEqual(["first.json", "second.json"]);
      }).pipe(Effect.scoped),
  );

  it.effect(
    "cancels an export and a queued job, lets another query finish, and recovers the Worker",
    () =>
      Effect.gen(function* () {
        const folder = yield* exportFolder;
        const held = yield* holdSlots;
        const reading = {
          reading: yield* Deferred.make<void>(),
          release: yield* Deferred.make<void>(),
        };
        chunkHold = reading;
        yield* Effect.addFinalizer(() =>
          Deferred.succeed(reading.release, undefined).pipe(
            Effect.andThen(
              Effect.sync(() => {
                chunkHold = undefined;
              }),
            ),
          ),
        );
        const running = yield* started(
          large.service.query({
            ...LARGE,
            id: "running",
            output: join(folder, "cancelled.json"),
          }),
        );
        const other = yield* started(
          large.service.query({ ...LARGE, fields: "[]", limit: "100" }),
        );
        yield* Queue.take(held.answered);
        yield* Queue.take(held.answered);
        const waiting = yield* started(
          large.service.query({ limit: "1", id: "waiting" }),
        );
        yield* Queue.takeBetween(held.requests, 3, 3);
        expect(yield* large.service.cancel("waiting")).toBe(true);
        expect(Exit.isFailure(yield* Fiber.await(waiting))).toBe(true);
        expect(yield* Queue.size(held.answered)).toBe(0);
        yield* Deferred.succeed(held.release, undefined);
        yield* Deferred.await(reading.reading);

        expect(yield* large.service.cancel("running")).toBe(true);

        expect(Exit.isFailure(yield* Fiber.await(running))).toBe(true);
        expect(JSON.parse(yield* Fiber.join(other)).ok).toBe(true);
        expect(yield* names(folder)).toEqual([]);
        expect(
          JSON.parse(yield* large.service.query({ limit: "1" })),
        ).toMatchObject({ ok: true, returnedCount: 1 });
      }).pipe(Effect.scoped),
  );
});
