import { it } from "@effect/vitest";
import { Effect, Fiber, Layer } from "effect";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { describe, expect, vi } from "vitest";

import type { Attachment } from "@zotlit/db";
import { rowInstant } from "@zotlit/db-testing";
import {
  BULK_LIBRARY,
  openScenarioDatabase,
  seedBulkLibrary,
} from "@zotlit/db-testing/scenario";
import type { ScenarioDatabase } from "@zotlit/db-testing/scenario";
import { connectClient } from "@zotlit/db/client/node";
import type { NodeDatabaseClient } from "@zotlit/db/client/node";
import { layerNodeFileSystemWith } from "@zotlit/obsidian-desktop/__fixtures__/node-file-system.ts";
import { workerQuery } from "@zotlit/query-views/__fixtures__/item-query/worker-query.ts";
import { queryJobRunner } from "@zotlit/query-views/desktop/item-query/job.ts";
import { makeAttachmentFileResolver } from "@zotlit/query-views/worker/item-query/attachment-files.ts";
import type { QueryJob } from "@zotlit/query-views/worker/item-query/worker-protocol.ts";
import {
  fileConfig,
  inProcessClient,
  sharedClientOpener,
} from "@zotlit/zotero-reads/__fixtures__/in-process.ts";
import { MY_LIBRARY_SCOPE } from "@zotlit/zotero-reads/contract/library-scope.ts";
import {
  Connection,
  layerRcRef,
} from "@zotlit/zotero-reads/worker/connection.ts";

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

function resolverWith(
  paths: Parameters<typeof makeAttachmentFileResolver>[0],
  probe: (path: string) => void,
) {
  return makeAttachmentFileResolver(paths).pipe(
    Effect.provide(
      layerNodeFileSystemWith((fs) => ({
        exists: (path) =>
          Effect.andThen(
            Effect.sync(() => probe(path)),
            fs.exists(path),
          ),
      })),
    ),
  );
}

function attachment(
  itemID: number,
  overrides: Pick<Attachment, "key" | "path" | "linkMode">,
): Attachment {
  return {
    itemID,
    libraryID: 1,
    groupID: null,
    indexedKey: overrides.key,
    parentItemID: 1,
    contentType: "application/pdf",
    dateAdded: rowInstant("2024-01-01T00:00:00Z"),
    dateModified: rowInstant("2024-01-01T00:00:00Z"),
    ...overrides,
  };
}

function jobOf(
  id: string,
  params: Record<string, string>,
  stagePath?: string,
): QueryJob {
  return {
    schema: false,
    dataset: "items",
    command: "zotlit:query",
    query: workerQuery(params),
    id,
    vault: IDENTITY.vault,
    scope: MY_LIBRARY_SCOPE,
    attachmentPaths: ATTACHMENT_PATHS,
    ...(stagePath === undefined ? {} : { stagePath }),
  };
}

function bulkExport(
  scenario: ScenarioDatabase<NodeDatabaseClient>,
  id: string,
): QueryJob {
  const directory = dirname(scenario.path);
  return jobOf(
    id,
    { ...BULK, output: join(directory, `${id}.json`) },
    join(directory, `.zotlit-query-${id}.tmp`),
  );
}

function clientOf(scenario: ScenarioDatabase<NodeDatabaseClient>) {
  let borrows = 0;
  const counted = Layer.effect(Connection)(
    Effect.gen(function* () {
      const connection = yield* Connection;
      return Connection.of({
        ...connection,
        borrow: Effect.acquireRelease(
          Effect.sync(() => {
            borrows++;
          }),
          () =>
            Effect.sync(() => {
              borrows--;
            }),
        ).pipe(Effect.andThen(connection.borrow)),
      });
    }),
  ).pipe(Layer.provide(layerRcRef(sharedClientOpener(scenario.db))));
  return {
    client: inProcessClient(
      counted,
      { queryJobs: queryJobRunner },
      fileConfig(IDENTITY.source.databasePath, IDENTITY.source.id),
    ),
    borrows: () => borrows,
  };
}

const writing = (job: QueryJob) =>
  Effect.promise(() =>
    vi.waitFor(
      async () => {
        expect(
          (await readFile(job.stagePath!, "utf8").catch(() => "")).length,
        ).toBeGreaterThan(0);
      },
      { timeout: 15000, interval: 1 },
    ),
  );

describe("ZoteroReads ItemQuery", () => {
  it.effect("answers the envelope of a job with its receipt", () =>
    Effect.gen(function* () {
      using scenario = openScenarioDatabase(connectClient);
      const { client, borrows } = clientOf(scenario);

      const answer = yield* Effect.scoped(
        Effect.flatMap(client, (reads) =>
          reads.ItemQuery({ job: jobOf("plain", { limit: "3" }) }),
        ),
      );

      expect(answer).toMatchObject({ receipt: { kind: "inline" } });
      expect(answer).not.toHaveProperty("cancelled");
      expect(JSON.parse(answer.answer)).toMatchObject({
        ok: true,
        identity: IDENTITY,
        returnedCount: 3,
      });
      expect(borrows()).toBe(0);
    }),
  );

  it.effect(
    "cancels a job while it waits for a slot, and then the running jobs",
    () =>
      Effect.gen(function* () {
        using scenario = openScenarioDatabase(connectClient, {
          storage: "temp-directory",
        });
        seedBulkLibrary(scenario.sqlite, 20000);
        const { client, borrows } = clientOf(scenario);
        const first = bulkExport(scenario, "first");

        const answers = yield* Effect.scoped(
          Effect.gen(function* () {
            const reads = yield* client;
            const running = yield* Effect.forkChild(
              Effect.forEach(
                [first, bulkExport(scenario, "second")],
                (job) => reads.ItemQuery({ job }),
                { concurrency: "unbounded" },
              ),
            );
            yield* writing(first);
            const waiting = yield* Effect.forkChild(
              reads.ItemQuery({ job: jobOf("waiting", { limit: "1" }) }),
            );
            yield* Effect.yieldNow;
            expect(borrows()).toBe(2);
            yield* reads.CancelItemQuery({ id: "waiting" });
            const cancelled = yield* Fiber.join(waiting);
            const stillRunning = running.pollUnsafe() === undefined;
            yield* reads.CancelItemQuery({ id: "first" });
            yield* reads.CancelItemQuery({ id: "second" });
            return {
              cancelled,
              stillRunning,
              running: yield* Fiber.join(running),
            };
          }),
        );

        expect(answers.cancelled).toEqual({
          command: "zotlit:query",
          answer: "",
          receipt: { kind: "inline" },
          cancelled: true,
        });
        expect(answers.stillRunning).toBe(true);
        for (const answer of answers.running)
          expect(answer).toMatchObject({ cancelled: true });
        expect(borrows()).toBe(0);
      }),
  );

  it.effect(
    "ends the job of a request that the client interrupts, and releases its borrow",
    () =>
      Effect.gen(function* () {
        using scenario = openScenarioDatabase(connectClient, {
          storage: "temp-directory",
        });
        seedBulkLibrary(scenario.sqlite, 20000);
        const { client, borrows } = clientOf(scenario);
        const job = bulkExport(scenario, "abandoned");

        const next = yield* Effect.scoped(
          Effect.gen(function* () {
            const reads = yield* client;
            const request = yield* Effect.forkChild(reads.ItemQuery({ job }));
            yield* writing(job);
            yield* Fiber.interrupt(request);
            yield* Effect.promise(() =>
              vi.waitFor(() => expect(borrows()).toBe(0), {
                timeout: 15000,
                interval: 1,
              }),
            );
            return yield* reads.ItemQuery({
              job: jobOf("next", { limit: "1" }),
            });
          }),
        );

        const staged = yield* Effect.promise(() =>
          readFile(job.stagePath!, "utf8"),
        );
        expect(() => JSON.parse(staged) as unknown).toThrow();
        expect(
          yield* Effect.promise(() => readdir(dirname(job.stagePath!))),
        ).not.toContain("abandoned.json");
        expect(JSON.parse(next.answer)).toMatchObject({ ok: true });
      }),
  );
});

describe("ZoteroReads Attachment files", () => {
  it.effect("resolves and probes each Attachment once within one query", () =>
    Effect.gen(function* () {
      using scenario = openScenarioDatabase(connectClient, {
        storage: "temp-directory",
      });
      const dataDir = dirname(scenario.path);
      const baseAttachmentPath = join(dataDir, "linked");
      const importedPath = join(dataDir, "storage", "IMPRT223", "paper.pdf");
      const linkedPath = join(baseAttachmentPath, "papers", "linked.pdf");
      yield* Effect.promise(() =>
        mkdir(dirname(importedPath), { recursive: true }),
      );
      yield* Effect.promise(() =>
        mkdir(dirname(linkedPath), { recursive: true }),
      );
      yield* Effect.promise(() =>
        Promise.all([
          writeFile(importedPath, "imported"),
          writeFile(linkedPath, "linked"),
        ]),
      );
      const probe = vi.fn<(path: string) => void>();
      const resolve = yield* resolverWith(
        { dataDir, baseAttachmentPath },
        probe,
      );
      const imported = attachment(10, {
        key: "IMPRT223",
        path: "storage:paper.pdf",
        linkMode: 0,
      });
      const linked = attachment(11, {
        key: "LINKD223",
        path: "attachments:papers/linked.pdf",
        linkMode: 2,
      });
      const missing = attachment(12, {
        key: "MISSI223",
        path: "storage:missing.pdf",
        linkMode: 0,
      });
      const linkedUrl = attachment(13, {
        key: "LINKU223",
        path: "https://example.com/paper.pdf",
        linkMode: 3,
      });

      const resolved = yield* Effect.all(
        [
          resolve(imported),
          resolve({ ...imported }),
          resolve(linked),
          resolve(missing),
          resolve(linkedUrl),
        ],
        { concurrency: "unbounded" },
      );

      expect(resolved).toEqual([
        { path: importedPath, exists: true },
        { path: importedPath, exists: true },
        { path: linkedPath, exists: true },
        {
          path: join(dataDir, "storage", "MISSI223", "missing.pdf"),
          exists: false,
        },
        { path: null, exists: false },
      ]);
      expect(probe.mock.calls.map(([path]) => path)).toEqual([
        importedPath,
        linkedPath,
        join(dataDir, "storage", "MISSI223", "missing.pdf"),
      ]);
    }),
  );

  it.effect(
    "does not probe a linked file when its base directory is unset",
    () =>
      Effect.gen(function* () {
        const probe = vi.fn<(path: string) => void>();
        const resolve = yield* resolverWith(
          { dataDir: "/zotero", baseAttachmentPath: null },
          probe,
        );

        expect(
          yield* resolve(
            attachment(20, {
              key: "LINKD456",
              path: "attachments:papers/linked.pdf",
              linkMode: 2,
            }),
          ),
        ).toEqual({ path: null, exists: false });
        expect(probe).not.toHaveBeenCalled();
      }),
  );
});
