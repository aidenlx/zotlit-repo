import type { QueryViewRequest } from "#worker/item-query/query-view.ts";
import type {
  QueryJob,
  QueryTypedJob,
} from "#worker/item-query/worker-protocol.ts";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { it } from "@effect/vitest";
import { Clock, Deferred, Effect, Fiber, Layer, Stream } from "effect";
import { TestClock } from "effect/testing";
import type { CliData } from "obsidian";
import { describe, expect, vi } from "vitest";

import {
  BULK_LIBRARY,
  openScenarioDatabase,
  seedBulkLibrary,
} from "@zotlit/db-testing/scenario";
import type { ScenarioDatabase } from "@zotlit/db-testing/scenario";
import { connectClient } from "@zotlit/db/client/node";
import type { NodeDatabaseClient } from "@zotlit/db/client/node";
import { ItemQuerySliceObserver } from "@zotlit/item-query";
import {
  inProcessClient,
  sharedClientOpener,
} from "@zotlit/zotero-reads/__fixtures__/in-process.ts";
import { DbUnavailable } from "@zotlit/zotero-reads/contract/db-unavailable.ts";
import { MY_LIBRARY_SCOPE } from "@zotlit/zotero-reads/contract/library-scope.ts";
import type { QueryAnswerPart } from "@zotlit/zotero-reads/contract/rpc.ts";
import {
  Connection,
  layerRcRef,
} from "@zotlit/zotero-reads/worker/connection.ts";

import { nodeQueryMeter } from "./node-meter.ts";

import { workerQuery } from "#__fixtures__/item-query/worker-query.ts";
import { makeAttachmentFileResolver } from "#worker/item-query/attachment-files.ts";
import { QUERY_COMMAND } from "#worker/item-query/contract.ts";
import { answerParts, makeQueryJobRunner } from "#worker/item-query/job.ts";

const testFileSystem = NodeFileSystem.layer;

const IDENTITY = {
  vault: { name: "Research", path: "/vaults/research" },
  source: {
    kind: "file" as const,
    id: "source-1",
    databasePath: "/zotero/zotero.sqlite",
  },
};

const BULK = {
  library: `group:${BULK_LIBRARY.groupID}`,
  limit: "all",
  fields: '["title","tags"]',
};

const ATTACHMENT_PATHS = {
  dataDir: "/zotero",
  baseAttachmentPath: null,
};

function jobOf(params: CliData): QueryJob {
  const query = workerQuery(params);
  return {
    schema: false,
    dataset: query.from,
    command: QUERY_COMMAND,
    query,
    id: "job-1",
    vault: IDENTITY.vault,
    scope: MY_LIBRARY_SCOPE,
    attachmentPaths: ATTACHMENT_PATHS,
  };
}

const answerOf = <E, R>(parts: Stream.Stream<QueryAnswerPart, E, R>) =>
  Effect.map(Stream.runCollect(parts), (collected) => ({
    text: new TextDecoder("utf-8", { ignoreBOM: true }).decode(
      Buffer.concat(
        collected.flatMap((part) =>
          part._tag === "Chunk" ? [part.bytes] : [],
        ),
      ),
    ),
    summary: collected.find((part) => part._tag === "Head")?.summary,
    measurement: collected.find((part) => part._tag === "Trace")?.measurement,
  }));

function viewJobOf(view: QueryViewRequest): QueryTypedJob {
  return {
    command: QUERY_COMMAND,
    schema: false,
    view,
    id: "view-1",
    vault: IDENTITY.vault,
    scope: MY_LIBRARY_SCOPE,
    attachmentPaths: ATTACHMENT_PATHS,
  };
}

const run = (scenario: ScenarioDatabase<NodeDatabaseClient>, job: QueryJob) =>
  Effect.gen(function* () {
    return yield* answerOf(
      answerParts(job, {
        client: scenario.db,
        identity: Effect.succeed(IDENTITY),
        meter: nodeQueryMeter,
        attachmentFiles: yield* makeAttachmentFileResolver(job.attachmentPaths),
      }),
    );
  }).pipe(Effect.provide(testFileSystem));

const scenarioOf = (options?: Parameters<typeof openScenarioDatabase>[1]) =>
  Effect.acquireDisposable(
    Effect.sync(() => openScenarioDatabase(connectClient, options)),
  );

describe("Query Job", () => {
  it.effect("streams the pretty JSON of its envelope", () =>
    Effect.gen(function* () {
      const scenario = yield* scenarioOf();

      const answer = yield* run(
        scenario,
        jobOf({ limit: "all", fields: '["title","creators"]' }),
      );

      expect(answer.text).toBe(
        JSON.stringify(JSON.parse(answer.text), null, 2),
      );
      expect(JSON.parse(answer.text)).toMatchObject({
        ok: true,
        returnedCount: 10,
      });
    }),
  );

  it.effect(
    "streams a result above the inline limit in full, because the window owns the limit",
    () =>
      Effect.gen(function* () {
        const scenario = yield* scenarioOf();
        seedBulkLibrary(scenario.sqlite, 6000);

        const answer = yield* run(scenario, jobOf(BULK));

        expect(Buffer.byteLength(answer.text)).toBeGreaterThan(1024 * 1024);
        expect(JSON.parse(answer.text)).toMatchObject({
          ok: true,
          returnedCount: 6000,
        });
      }),
  );

  it.effect(
    "ends the Worker time of a measured job when the reader takes the last chunk",
    () =>
      Effect.gen(function* () {
        const scenario = yield* scenarioOf();
        const headRead = yield* Deferred.make<void>();
        const job = { ...jobOf({ limit: "1" }), measure: true };
        const reading = yield* Effect.forkChild(
          answerOf(
            answerParts(job, {
              client: scenario.db,
              identity: Effect.succeed(IDENTITY),
              meter: nodeQueryMeter,
              attachmentFiles: yield* makeAttachmentFileResolver(
                job.attachmentPaths,
              ).pipe(Effect.provide(testFileSystem)),
            }).pipe(
              Stream.tap((part) =>
                part._tag === "Head"
                  ? Deferred.succeed(headRead, undefined).pipe(
                      Effect.andThen(Effect.sleep("1 second")),
                    )
                  : Effect.void,
              ),
            ),
          ),
        );
        yield* Deferred.await(headRead);
        yield* TestClock.adjust("1 second");

        const answer = yield* Fiber.join(reading);

        expect(JSON.parse(answer.text)).toMatchObject({ ok: true });
        expect(answer.measurement?.workerMs).toBeGreaterThanOrEqual(1000);
      }),
  );

  it.effect("gives the Worker measurement of a measured job that fails", () =>
    Effect.gen(function* () {
      const scenario = yield* scenarioOf();
      const job = { ...jobOf({ fields: '["notAField"]' }), measure: true };

      const failed = yield* Effect.flip(
        answerOf(
          answerParts(job, {
            client: scenario.db,
            identity: Effect.succeed(IDENTITY),
            meter: nodeQueryMeter,
            attachmentFiles: yield* makeAttachmentFileResolver(
              job.attachmentPaths,
            ).pipe(Effect.provide(testFileSystem)),
          }),
        ),
      );

      expect(failed).toMatchObject({
        _tag: "QueryFailed",
        diagnostic: { code: "unknown-field" },
        measurement: { workerMs: expect.any(Number) },
      });
    }),
  );

  it.live(
    "reports only each job's work when two measured jobs overlap",
    ({ annotate }) =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          annotate(
            "https://github.com/aidenlx/zotlit-repo/issues/150",
            "issue",
          ),
        );
        const scenario = yield* scenarioOf();
        const clock = yield* Clock.Clock;
        let now = 0;
        yield* Effect.acquireDisposable(
          Effect.sync(() =>
            vi
              .spyOn(clock, "monotonicTimeNanosUnsafe")
              .mockImplementation(() => BigInt(now) * 1_000_000n),
          ),
        );
        const release = Promise.withResolvers<void>();
        const start = (id: string, fields: string, workMs: number) =>
          Effect.gen(function* () {
            const waiting = yield* Deferred.make<void>();
            const job = jobOf({
              from: "attachments",
              filter: 'linkMode == "imported_file"',
              limit: "1",
              fields,
            });
            const fiber = yield* Effect.forkChild(
              answerOf(
                answerParts(
                  { ...job, id, measure: true },
                  {
                    client: scenario.db,
                    identity: Effect.succeed(IDENTITY),
                    meter: nodeQueryMeter,
                    attachmentFiles: () =>
                      Effect.promise(async () => {
                        Deferred.doneUnsafe(waiting, Effect.void);
                        await release.promise;
                        now += workMs;
                        return { path: "/paper.pdf", exists: true };
                      }),
                  },
                ),
              ),
            );
            return { fiber, waiting };
          });
        const first = yield* start("job-1", "exists", 7);
        const second = yield* start("job-2", "exists,tags", 23);
        yield* Deferred.await(first.waiting);
        yield* Deferred.await(second.waiting);

        yield* Effect.promise(
          () =>
            new Promise<void>((resolve) => {
              setImmediate(() => {
                now += 70;
                release.resolve();
                resolve();
              });
            }),
        );
        const answerA = yield* Fiber.join(first.fiber);
        const answerB = yield* Fiber.join(second.fiber);

        expect(JSON.parse(answerA.text)).toMatchObject({
          ok: true,
          returnedCount: 1,
        });
        expect(JSON.parse(answerB.text)).toMatchObject({
          ok: true,
          returnedCount: 1,
        });
        expect(answerA.measurement?.slices.filter((ms) => ms > 0)).toEqual([7]);
        expect(answerB.measurement?.slices.filter((ms) => ms > 0)).toEqual([
          23,
        ]);
        expect(
          answerA.measurement?.statements["attachment-tags"],
        ).toBeUndefined();
        expect(answerB.measurement?.statements["attachment-tags"]?.count).toBe(
          1,
        );
      }),
  );

  it.live(
    "gives another effect a turn at a pause of a bulk query on the job fiber",
    () =>
      Effect.gen(function* () {
        const scenario = yield* scenarioOf({ storage: "temp-directory" });
        seedBulkLibrary(scenario.sqlite, 20000);
        const events: string[] = [];
        const firstPause = yield* Deferred.make<void>();

        const job = yield* Effect.forkChild(
          run(scenario, jobOf(BULK)).pipe(
            Effect.provideService(ItemQuerySliceObserver, {
              paused: () => {
                events.push("pause");
                Deferred.doneUnsafe(firstPause, Effect.void);
              },
              resumed: () => events.push("resume"),
            }),
          ),
        );
        yield* Deferred.await(firstPause);
        yield* Effect.sleep("1 millis");
        events.push("other");
        const answer = yield* Fiber.join(job);

        const other = events.indexOf("other");
        expect(events[other - 1]).toBe("pause");
        expect(events.slice(other)).toContain("resume");
        expect(JSON.parse(answer.text)).toMatchObject({
          returnedCount: 20000,
        });
      }),
  );
});

describe("the Query Job runner", () => {
  const runner = makeQueryJobRunner({ meter: {} });
  const MARKER = {
    kind: "web-api" as const,
    id: "web-api:1",
    userID: 1,
    username: "marker",
  };

  it.effect("stamps the identity that the connection gives", () =>
    Effect.gen(function* () {
      const scenario = yield* scenarioOf();
      const answer = yield* answerOf(
        runner.answer(jobOf({ limit: "1" }), {
          client: scenario.db,
          identity: Effect.succeed(MARKER),
        }),
      ).pipe(Effect.provide(testFileSystem));
      const stamped = {
        ok: true,
        identity: { vault: IDENTITY.vault, source: MARKER },
      };
      expect(answer.summary).toMatchObject(stamped);
      expect(JSON.parse(answer.text)).toMatchObject(stamped);
    }),
  );

  it.effect(
    "answers database-error when the identity cannot be read, and a Query View job does not read it",
    () =>
      Effect.gen(function* () {
        const scenario = yield* scenarioOf();
        let reads = 0;
        const failing = Effect.suspend(() => {
          reads++;
          return Effect.fail(new DbUnavailable({ message: "settings gone" }));
        });
        const cli = yield* Effect.flip(
          answerOf(
            runner.answer(jobOf({ limit: "1" }), {
              client: scenario.db,
              identity: failing,
            }),
          ).pipe(Effect.provide(testFileSystem)),
        );
        expect(cli).toMatchObject({
          _tag: "QueryFailed",
          diagnostic: { code: "database-error" },
        });
        expect(reads).toBe(1);
        const view = yield* runner
          .run(viewJobOf({ from: "items", fields: ["title"], limit: 1 }), {
            client: scenario.db,
            identity: failing,
          })
          .pipe(Effect.scoped, Effect.provide(testFileSystem));
        expect(view.view).toMatchObject({ kind: "result" });
        expect(reads).toBe(1);
      }),
  );

  it.effect(
    "streams the document of an export through the QueryAnswer handler, in the borrow, with no file system of the root",
    () =>
      Effect.gen(function* () {
        const scenario = yield* scenarioOf();
        let borrows = 0;
        const counted = Layer.effect(Connection)(
          Effect.map(Connection, (connection) =>
            Connection.of({
              ...connection,
              borrow: Effect.andThen(
                Effect.sync(() => {
                  borrows++;
                }),
                connection.borrow,
              ),
            }),
          ),
        ).pipe(Layer.provide(layerRcRef(sharedClientOpener(scenario.db))));
        const reads = yield* inProcessClient(counted, { queryJobs: runner });
        const params = { limit: "all", fields: '["title"]' };

        const parts = yield* Stream.runCollect(
          reads.QueryAnswer({
            job: jobOf({ ...params, format: "csv", output: "/exports/a.csv" }),
          }),
        );

        expect(borrows).toBe(1);
        expect(parts[0]).toMatchObject({
          _tag: "Head",
          summary: { ok: true, returnedCount: 10 },
        });
        const lines = new TextDecoder("utf-8", { ignoreBOM: true })
          .decode(
            Buffer.concat(
              parts.flatMap((part) =>
                part._tag === "Chunk" ? [part.bytes] : [],
              ),
            ),
          )
          .split("\r\n");
        const view = yield* reads.ItemQuery({
          job: viewJobOf({
            from: "items",
            fields: ["title"],
            sort: [{ field: "dateModified", direction: "desc" }],
          }),
        });
        if (view.view?.kind !== "result") throw new Error(view.view?.kind);
        expect(lines[0]).toBe(`${String.fromCharCode(0xfeff)}indexedKey,title`);
        expect(lines.slice(1, -1).map((line) => line.split(",")[0])).toEqual(
          view.view.result.rows?.map((row) => row.indexedKey),
        );
        expect(lines.at(-1)).toBe("");
      }).pipe(Effect.scoped),
  );
});
