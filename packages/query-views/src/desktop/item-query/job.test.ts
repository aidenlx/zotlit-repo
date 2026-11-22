import { it } from "@effect/vitest";
import { Clock, Deferred, Effect, Fiber, PlatformError } from "effect";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
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
import { layerNodeFileSystemWith } from "@zotlit/obsidian-desktop/__fixtures__/node-file-system.ts";
import { MY_LIBRARY_SCOPE } from "@zotlit/zotero-reads/contract/library-scope.ts";

import { QUERY_COMMAND } from "./contract.ts";
import { runQueryJob } from "./job.ts";
import type { QueryJob } from "./worker-protocol.ts";

import { workerQuery } from "#__fixtures__/item-query/worker-query.ts";
import { makeAttachmentFileResolver } from "#core/item-query/attachment-files.ts";

let closeFailure: PlatformError.PlatformError | undefined;

const testFileSystem = layerNodeFileSystemWith((fs) => ({
  open: (path, options) =>
    fs.open(path, options).pipe(
      Effect.tap(() =>
        Effect.addFinalizer(() => {
          const failure = closeFailure;
          closeFailure = undefined;
          return failure ? Effect.die(failure) : Effect.void;
        }),
      ),
    ),
}));

const IDENTITY = {
  vault: { name: "Research", path: "/vaults/research" },
  source: { id: "source-1", databasePath: "/zotero/zotero.sqlite" },
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

function jobOf(params: CliData, stagePath?: string): QueryJob {
  const query = workerQuery(params);
  return {
    schema: false,
    dataset: query.from,
    command: QUERY_COMMAND,
    query,
    id: "job-1",
    ...IDENTITY,
    scope: MY_LIBRARY_SCOPE,
    attachmentPaths: ATTACHMENT_PATHS,
    ...(stagePath === undefined ? {} : { stagePath }),
  };
}

const run = (scenario: ScenarioDatabase<NodeDatabaseClient>, job: QueryJob) =>
  Effect.gen(function* () {
    return yield* runQueryJob(job, {
      client: scenario.db,
      identity: IDENTITY,
      attachmentFiles: yield* makeAttachmentFileResolver(job.attachmentPaths),
    });
  }).pipe(Effect.provide(testFileSystem));

const scenarioOf = (options?: Parameters<typeof openScenarioDatabase>[1]) =>
  Effect.acquireDisposable(
    Effect.sync(() => openScenarioDatabase(connectClient, options)),
  );

const textOf = (path: string) => Effect.promise(() => readFile(path, "utf8"));

function exportPaths(scenario: ScenarioDatabase<NodeDatabaseClient>) {
  const directory = dirname(scenario.path);
  return {
    output: join(directory, "items.json"),
    stagePath: join(directory, ".zotlit-query-job-1.tmp"),
  };
}

describe("Query Job", () => {
  it.effect("answers inline with the pretty JSON of its envelope", () =>
    Effect.gen(function* () {
      const scenario = yield* scenarioOf();

      const answer = yield* run(
        scenario,
        jobOf({ limit: "all", fields: '["title","creators"]' }),
      );

      expect(answer.receipt).toEqual({ kind: "inline" });
      expect(answer.answer).toBe(
        JSON.stringify(JSON.parse(answer.answer), null, 2),
      );
      expect(JSON.parse(answer.answer)).toMatchObject({
        ok: true,
        returnedCount: 10,
      });
    }),
  );

  it.effect.each([undefined, 'tags != "absent"'])(
    "writes an export and warnings to the staging file and receipt: %s",
    (filter) =>
      Effect.gen(function* () {
        const scenario = yield* scenarioOf({ storage: "temp-directory" });
        seedBulkLibrary(scenario.sqlite, 600);
        const { output, stagePath } = exportPaths(scenario);
        const params = { ...BULK, ...(filter ? { filter } : {}) };
        const inline = yield* run(scenario, jobOf(params));

        const answer = yield* run(
          scenario,
          jobOf({ ...params, output }, stagePath),
        );
        const warnings = JSON.parse(inline.answer).warnings;
        expect(warnings).toHaveLength(filter ? 1 : 0);
        expect(JSON.parse(answer.answer).warnings).toEqual(warnings);

        const bytes = Buffer.byteLength(inline.answer);
        expect(answer.receipt).toEqual({ kind: "file", path: output, bytes });
        expect(JSON.parse(answer.answer)).toMatchObject({
          ok: true,
          returnedCount: 600,
          file: { path: output, bytes, format: "json" },
        });
        expect(JSON.parse(answer.answer)).not.toHaveProperty("rows");
        expect(yield* textOf(stagePath)).toBe(inline.answer);
        expect(
          yield* Effect.promise(() => readdir(dirname(output))),
        ).not.toContain("items.json");
      }),
  );

  it.effect(
    "answers result-too-large for an inline result above the limit",
    () =>
      Effect.gen(function* () {
        const scenario = yield* scenarioOf();
        seedBulkLibrary(scenario.sqlite, 6000);

        const answer = yield* run(scenario, jobOf(BULK));

        expect(answer.receipt).toEqual({ kind: "inline" });
        expect(JSON.parse(answer.answer)).toMatchObject({
          ok: false,
          diagnostic: { code: "result-too-large" },
        });
      }),
  );

  it.effect(
    "answers output-error with no file receipt when the staging file does not close",
    () =>
      Effect.gen(function* () {
        const scenario = yield* scenarioOf({ storage: "temp-directory" });
        const { output, stagePath } = exportPaths(scenario);
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            closeFailure = undefined;
          }),
        );
        closeFailure = PlatformError.systemError({
          _tag: "Unknown",
          module: "FileSystem",
          method: "close",
          cause: Object.assign(new Error("EIO: i/o error, close"), {
            code: "EIO",
          }),
        });

        const answer = yield* run(
          scenario,
          jobOf({ output, filter: 'tags != "absent"' }, stagePath),
        );

        expect(closeFailure).toBeUndefined();
        expect(answer.receipt).toEqual({ kind: "inline" });
        expect(JSON.parse(answer.answer)).toMatchObject({
          ok: false,
          diagnostic: {
            code: "output-error",
            message: "EIO: i/o error, close",
          },
        });
        expect(JSON.parse(answer.answer)).not.toHaveProperty("warnings");
        expect(yield* textOf(stagePath)).not.toBe("");
      }),
  );

  it.effect(
    "answers output-error when the staging file cannot be opened, and keeps the file there",
    () =>
      Effect.gen(function* () {
        const scenario = yield* scenarioOf({ storage: "temp-directory" });
        const { output, stagePath } = exportPaths(scenario);
        yield* Effect.promise(() => writeFile(stagePath, "keep this content"));

        const answer = yield* run(scenario, jobOf({ output }, stagePath));

        expect(answer.receipt).toEqual({ kind: "inline" });
        expect(JSON.parse(answer.answer)).toMatchObject({
          ok: false,
          diagnostic: { code: "output-error" },
        });
        expect(yield* textOf(stagePath)).toBe("keep this content");
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
              runQueryJob(
                { ...job, id, measure: true },
                {
                  client: scenario.db,
                  identity: IDENTITY,
                  attachmentFiles: () =>
                    Effect.promise(async () => {
                      Deferred.doneUnsafe(waiting, Effect.void);
                      await release.promise;
                      now += workMs;
                      return { path: "/paper.pdf", exists: true };
                    }),
                },
              ).pipe(Effect.provide(testFileSystem)),
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

        expect(JSON.parse(answerA.answer)).toMatchObject({
          ok: true,
          returnedCount: 1,
        });
        expect(JSON.parse(answerB.answer)).toMatchObject({
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
        const { output, stagePath } = exportPaths(scenario);
        const events: string[] = [];
        const firstPause = yield* Deferred.make<void>();

        const job = yield* Effect.forkChild(
          runQueryJob(jobOf({ ...BULK, output }, stagePath), {
            client: scenario.db,
            identity: IDENTITY,
            attachmentFiles: yield* makeAttachmentFileResolver(
              ATTACHMENT_PATHS,
            ).pipe(Effect.provide(testFileSystem)),
          }).pipe(
            Effect.provide(testFileSystem),
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
        expect(JSON.parse(answer.answer)).toMatchObject({
          returnedCount: 20000,
        });
      }),
  );
});
