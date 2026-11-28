import { it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Layer, Queue, Stream } from "effect";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { describe, expect, vi } from "vitest";

import type { Attachment } from "@zotlit/db";
import { rowInstant } from "@zotlit/db-testing";
import { openScenarioDatabase } from "@zotlit/db-testing/scenario";
import type { ScenarioDatabase } from "@zotlit/db-testing/scenario";
import { connectClient } from "@zotlit/db/client/node";
import type { NodeDatabaseClient } from "@zotlit/db/client/node";
import { layerNodeFileSystemWith } from "@zotlit/obsidian-desktop/__fixtures__/node-file-system.ts";
import { workerQuery } from "@zotlit/query-views/__fixtures__/item-query/worker-query.ts";
import { queryJobRunner } from "@zotlit/query-views/desktop/item-query/job.ts";
import { makeAttachmentFileResolver } from "@zotlit/query-views/worker/item-query/attachment-files.ts";
import type {
  QueryJob,
  QueryTypedJob,
} from "@zotlit/query-views/worker/item-query/worker-protocol.ts";
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

function jobOf(id: string, params: Record<string, string>): QueryJob {
  return {
    schema: false,
    dataset: "items",
    command: "zotlit:query",
    query: workerQuery(params),
    id,
    vault: IDENTITY.vault,
    scope: MY_LIBRARY_SCOPE,
    attachmentPaths: ATTACHMENT_PATHS,
  };
}

function viewJobOf(id: string): QueryTypedJob {
  return {
    command: "zotlit:query",
    schema: false,
    view: { from: "items", fields: [], limit: 1 },
    id,
    vault: IDENTITY.vault,
    scope: MY_LIBRARY_SCOPE,
    attachmentPaths: ATTACHMENT_PATHS,
  };
}

function clientOf(
  scenario: ScenarioDatabase<NodeDatabaseClient>,
  { hold }: { hold?: Deferred.Deferred<void> } = {},
) {
  let borrows = 0;
  const acquired = Effect.runSync(Queue.unbounded<void>());
  const released = Effect.runSync(Queue.unbounded<void>());
  const counted = Layer.effect(Connection)(
    Effect.gen(function* () {
      const connection = yield* Connection;
      return Connection.of({
        ...connection,
        borrow: Effect.gen(function* () {
          let taken = false;
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              if (!taken) return;
              borrows--;
              Queue.offerUnsafe(released, undefined);
            }),
          );
          const client = yield* connection.borrow;
          taken = true;
          borrows++;
          Queue.offerUnsafe(acquired, undefined);
          if (hold) yield* Deferred.await(hold);
          return client;
        }),
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
    acquired: (count: number) =>
      Effect.asVoid(Queue.takeBetween(acquired, count, count)),
    released: (count: number) =>
      Effect.asVoid(Queue.takeBetween(released, count, count)),
  };
}

describe("ZoteroReads ItemQuery", () => {
  it.effect("streams the envelope of a job", () =>
    Effect.gen(function* () {
      using scenario = openScenarioDatabase(connectClient);
      const { client, borrows } = clientOf(scenario);

      const parts = yield* Effect.scoped(
        Effect.flatMap(client, (reads) =>
          Stream.runCollect(
            reads.QueryAnswer({ job: jobOf("plain", { limit: "3" }) }),
          ),
        ),
      );

      const envelope = {
        ok: true,
        identity: IDENTITY,
        returnedCount: 3,
      };
      expect(parts[0]).toMatchObject({ _tag: "Head", summary: envelope });
      expect(
        JSON.parse(
          new TextDecoder().decode(
            Buffer.concat(
              parts.flatMap((part) =>
                part._tag === "Chunk" ? [part.bytes] : [],
              ),
            ),
          ),
        ),
      ).toMatchObject(envelope);
      expect(borrows()).toBe(0);
    }),
  );

  it.effect(
    "cancels a job while it waits for a slot, and then the running jobs",
    () =>
      Effect.gen(function* () {
        using scenario = openScenarioDatabase(connectClient);
        const hold = yield* Deferred.make<void>();
        const { client, borrows, acquired } = clientOf(scenario, { hold });

        const answers = yield* Effect.scoped(
          Effect.gen(function* () {
            const reads = yield* client;
            const running = yield* Effect.forkChild(
              Effect.forEach(
                [viewJobOf("first"), viewJobOf("second")],
                (job) => reads.ItemQuery({ job }),
                { concurrency: "unbounded" },
              ),
            );
            yield* acquired(2);
            const waiting = yield* Effect.forkChild(
              reads.ItemQuery({ job: viewJobOf("waiting") }),
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
        using scenario = openScenarioDatabase(connectClient);
        const hold = yield* Deferred.make<void>();
        const { client, borrows, acquired, released } = clientOf(scenario, {
          hold,
        });
        const job = viewJobOf("abandoned");

        const next = yield* Effect.scoped(
          Effect.gen(function* () {
            const reads = yield* client;
            const request = yield* Effect.forkChild(reads.ItemQuery({ job }));
            yield* acquired(1);
            yield* Fiber.interrupt(request);
            yield* released(1);
            expect(borrows()).toBe(0);
            yield* Deferred.succeed(hold, undefined);
            return yield* reads.ItemQuery({ job: viewJobOf("next") });
          }),
        );

        expect(next.view).toMatchObject({ kind: "result" });
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
