import type { QueryFixture } from "#__fixtures__/item-query.ts";
import type {
  QueryViewOutcome,
  QueryViewRequest,
} from "#worker/item-query/query-view.ts";
import type { WorkerMeasurement } from "#worker/item-query/trace.ts";
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect } from "vitest";

import type { NodeDatabaseClient } from "@zotlit/db/client/node";
import { PARITY_USER } from "@zotlit/db/replica/parity-pair";
import reports from "@zotlit/item-query/diagnostic-reports.json" with { type: "json" };
import { ItemMatchQuery } from "@zotlit/notes/core/profile-selection/item-matches.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { openScenarioApi } from "@zotlit/web-library/fake-zotero-api/scenario";
import type { ScenarioApi } from "@zotlit/web-library/fake-zotero-api/scenario";
import {
  fileConfig,
  inProcessReadsService,
  sharedClientOpener,
} from "@zotlit/zotero-reads/__fixtures__/in-process.ts";
import { webApiReadsService } from "@zotlit/zotero-reads/__fixtures__/web-api-reads.ts";
import { fakeApiFetch } from "@zotlit/zotero-reads/__fixtures__/web-api.ts";
import { MY_LIBRARY_SCOPE } from "@zotlit/zotero-reads/contract/library-scope.ts";

import { layerItemMatchQuery } from "./item-matches.ts";
import { queryJobRunner } from "./job.ts";
import { QueryService } from "./service.ts";

import { buildQueryService } from "#__fixtures__/item-query.ts";
import { searchAnnotations } from "#desktop/annotation-suggest/annotation-search.ts";
import {
  readerFailureText,
  readerWarningText,
} from "#obsidian/query-view/reader-failure.ts";
import { makeQueryJobRunner } from "#worker/item-query/job.ts";

const SHELL_FORM = /zotlit:|[a-z][\w-]*='|[a-z][\w-]*=<|\blibrary=/;

interface Sources {
  readonly file: QueryFixture;
  readonly web: QueryFixture;
}

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
      { queryJobs: makeQueryJobRunner({ meter: {}, writesFiles: false }) },
    ),
  );
  const build = (reads: typeof fileReads) =>
    buildQueryService(
      {
        reads: reads.reads,
        pluginVersion: "2.2.0-beta.2",
        source,
        effective: () => MY_LIBRARY_SCOPE,
        vaultName: "Online library",
        basePath: dirname(desktop.path),
      },
      stack,
    );
  sources = { file: await build(fileReads), web: await build(webReads) };
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

  it.effect(
    "refuses an export with export-unavailable before the query runs, because the Web Worker writes no file",
    () =>
      Effect.gen(function* () {
        const directory = yield* Effect.acquireRelease(
          Effect.promise(() => mkdtemp(join(tmpdir(), "zotlit-online-"))),
          (path) =>
            Effect.promise(() => rm(path, { recursive: true, force: true })),
        );
        const answer = JSON.parse(
          yield* sources.web.service.query({
            output: join(directory, "online.json"),
          }),
        ) as { ok: boolean; diagnostic?: { code: string } };
        expect(answer).toMatchObject({
          ok: false,
          diagnostic: { code: "export-unavailable" },
        });
        expect(yield* Effect.promise(() => readdir(directory))).toEqual([]);
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
