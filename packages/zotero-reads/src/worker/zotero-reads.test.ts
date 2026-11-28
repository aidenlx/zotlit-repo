import type { ZoteroReadsClient } from "#contract/rpc.ts";
import type {
  ChangeEvent,
  ReadsConfig,
  SegmenterBinary,
} from "#contract/rpc.ts";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { it } from "@effect/vitest";
import {
  Effect,
  Exit,
  Fiber,
  Latch,
  Layer,
  PubSub,
  Schema,
  Scope,
  Stream,
} from "effect";
import { TestClock } from "effect/testing";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect } from "vitest";

import {
  buildNoteContextFromSource,
  getIndexedItemRowsRange,
  getIndexSignatureRange,
} from "@zotlit/db";
import type { NoteResolvers } from "@zotlit/db";
import { createFixtureSchema } from "@zotlit/db-testing";
import { createClient } from "@zotlit/db/client/node";
import type { NodeDatabaseClient } from "@zotlit/db/client/node";
import { ItemQueryDatabase, readLibraries } from "@zotlit/db/item-query";

import type { ConnectionOpener } from "./connection.ts";
import { layerRcRef } from "./connection.ts";
import { Connection } from "./connection.ts";
import type { HandlersOptions, QueryJobRunner } from "./handlers.ts";
import { makeInProcessClient } from "./in-process.ts";
import { layerUnpinnedConnectionItemSource } from "./item-source.ts";
import { layerAbsentFileSystem } from "./serve-web-api.ts";
import { exportItemSnapshot } from "./snapshot/export.ts";

import {
  fileConfig,
  inProcessReadsService,
  sharedClientOpener,
} from "#__fixtures__/in-process.ts";
import { SEED } from "#__fixtures__/reads-seed.ts";
import { memoryWebApiSource, seededApi } from "#__fixtures__/web-api.ts";
import { Instant } from "#contract/instant-codec.ts";
import { DbUnavailable, SnapshotExpired, SnapshotId } from "#contract/rpc.ts";
import { nodeClient } from "#desktop/node-client.ts";
import { snapshotRevision } from "#desktop/snapshot-revision.ts";

function fixtureOpener(extra: (open: number) => string | null = () => "") {
  const log: string[] = [];
  const configs: (ReadsConfig | null)[] = [];
  const closes = new Map<number, PromiseWithResolvers<void>>();
  const closeSignal = (id: number) => {
    let signal = closes.get(id);
    if (!signal) {
      signal = Promise.withResolvers<void>();
      closes.set(id, signal);
    }
    return signal;
  };
  let opened = 0;
  let statements = 0;
  let compiles = 0;
  const runs: { open: number; sql: string }[] = [];
  const open: ConnectionOpener = (config) => {
    const id = ++opened;
    configs.push(config);
    const sql = extra(id);
    if (sql === null) throw new Error(`source #${id} is not readable`);
    const client: NodeDatabaseClient = createClient(":memory:");
    const sqlite = client.$client;
    createFixtureSchema(sqlite);
    sqlite.exec(SEED);
    sqlite.exec(
      `update libraries set version = ${id} where libraryID = 1; ${sql}`,
    );
    const prepare = sqlite.prepare.bind(sqlite);
    sqlite.prepare = (source: string) => {
      compiles += 1;
      const statement = prepare(source);
      const methods = statement as unknown as Record<
        "all" | "get" | "run" | "iterate",
        (...args: unknown[]) => unknown
      >;
      for (const method of ["all", "get", "run", "iterate"] as const) {
        const run = methods[method].bind(statement);
        methods[method] = (...args) => {
          statements += 1;
          runs.push({ open: id, sql: source });
          return run(...args);
        };
      }
      return statement;
    };
    const close = sqlite.close.bind(sqlite);
    sqlite.close = () => {
      log.push(`close #${id}`);
      close();
      closeSignal(id).resolve();
    };
    log.push(`open #${id}`);
    return nodeClient(client);
  };
  return {
    open,
    log,
    configs,
    closed: (id: number) => Effect.promise(() => closeSignal(id).promise),
    statements: () => statements,
    compiles: () => compiles,
    ran: (sql: string, open?: number) =>
      runs.filter(
        (entry) =>
          entry.sql === sql && (open === undefined || entry.open === open),
      ).length,
  };
}

function withReads<A, E>(
  opener: ConnectionOpener,
  body: (
    reads: ZoteroReadsClient,
  ) => Effect.Effect<A, E, Connection | Scope.Scope>,
  options?: Partial<HandlersOptions>,
): Effect.Effect<A, E> {
  return Effect.gen(function* () {
    const reads = yield* makeInProcessClient({ snapshotRevision, ...options });
    return yield* body(reads);
  }).pipe(
    Effect.scoped,
    Effect.provide([layerRcRef(opener), NodeFileSystem.layer]),
  );
}

const connectionSeen = (reads: ZoteroReadsClient, snapshot?: SnapshotId) =>
  Effect.map(
    reads.Libraries(snapshot === undefined ? {} : { snapshot }),
    (libraries) => libraries.find((l) => l.libraryID === 1)!.version,
  );

const take = <A, E>(
  pull: Effect.Effect<readonly A[], E | import("effect").Cause.Done>,
  n: number,
) =>
  Effect.gen(function* () {
    const out: A[] = [];
    while (out.length < n) out.push(...(yield* pull));
    return out;
  });

const noteResolvers: NoteResolvers = {
  item: {
    notePath: (item) => `notes/${item.indexedKey}.md`,
    noteLink: (item) => `[[notes/${item.indexedKey}]]`,
    authorsShort: (item) => `short:${item.key}`,
  },
  annotation: {
    filePath: (attachment) => `/abs/${attachment.key}`,
    fileLink: (attachment) => () => `[[${attachment.key}]]`,
    annotationImageLink: () => null,
    commentToMarkdown: (html) => `md(${html})`,
    authorsShort: (item) => `short:${item.key}`,
  },
  resolveChildNote: (note) => ({
    key: note.key,
    indexedKey: note.indexedKey,
    title: note.title,
    noteLink: () => `[[${note.key}]]`,
  }),
};

type ItemIDOf = (key: string) => number;

interface ReadsSource {
  readonly name: "file" | "web-api";
  readonly withReads: <A, E>(
    extra: string,
    body: (
      reads: ZoteroReadsClient,
      id: ItemIDOf,
    ) => Effect.Effect<A, E, Connection | Scope.Scope>,
    options?: Partial<HandlersOptions>,
  ) => Effect.Effect<A, E>;
}

const itemIDs = Effect.gen(function* () {
  const connection = yield* Connection;
  const rows = yield* Effect.scoped(
    Effect.map(connection.borrow, (client) =>
      client.all<{ key: string; itemID: number }>(
        "select key, itemID from items",
      ),
    ),
  ).pipe(Effect.orDie);
  const ids = new Map(rows.map((row) => [row.key, Number(row.itemID)]));
  return (key: string): number => {
    const found = ids.get(key);
    if (found === undefined) throw new Error(`no item ${key} in the source`);
    return found;
  };
});

const fileSource: ReadsSource = {
  name: "file",
  withReads: (extra, body, options) =>
    withReads(
      fixtureOpener(() => extra).open,
      (reads) => Effect.flatMap(itemIDs, (id) => body(reads, id)),
      options,
    ),
};

const WEB_API_ACCOUNT = { userID: 42, username: "reader" } as const;

const webApiSource: ReadsSource = {
  name: "web-api",
  withReads: (extra, body, options) =>
    Effect.gen(function* () {
      const reads = yield* makeInProcessClient({
        snapshotRevision,
        itemSource: layerUnpinnedConnectionItemSource,
        ...options,
      });
      const id = yield* itemIDs;
      return yield* body(reads, id);
    }).pipe(
      Effect.scoped,
      Effect.provide([
        memoryWebApiSource(
          seededApi(
            `${SEED}\nupdate libraries set version = 1 where libraryID = 1;\n${extra}`,
            WEB_API_ACCOUNT,
          ),
        ),
        layerAbsentFileSystem,
      ]),
    ),
};

const libraryQueryJobs: QueryJobRunner = {
  run: (job, { client }) =>
    readLibraries.pipe(
      Effect.provideService(ItemQueryDatabase, { client }),
      Effect.orDie,
      Effect.map((libraries) => {
        const answer = {
          command: job.command,
          libraries: libraries.map(({ type, groupID }) => ({ type, groupID })),
        };
        return answer;
      }),
    ),
  answer: (job, { client }) =>
    Stream.fromEffect(
      readLibraries.pipe(
        Effect.provideService(ItemQueryDatabase, { client }),
        Effect.orDie,
      ),
    ).pipe(
      Stream.flatMap((libraries) =>
        Stream.make(
          {
            _tag: "Head" as const,
            summary: {
              command: job.command,
              libraries: libraries.map(({ type, groupID }) => ({
                type,
                groupID,
              })),
            },
          },
          { _tag: "Chunk" as const, bytes: new TextEncoder().encode("{}") },
        ),
      ),
    ),
  cancelled: (job) => ({ command: job.command }),
};

function describeReadOperations(source: ReadsSource) {
  const web = source.name === "web-api";
  const withSource = source.withReads;
  const noteTitle = web ? "body" : "Methods";

  describe(`ZoteroReads operations over the ${source.name} source`, () => {
    it.effect("Libraries lists every library with its group", () =>
      Effect.gen(function* () {
        const libraries = yield* withSource("", (reads) => reads.Libraries({}));
        expect(libraries).toEqual([
          {
            libraryID: 1,
            type: "user",
            version: web ? expect.any(Number) : 1,
            clientVersion: web ? 0 : 3,
            groupID: null,
            name: null,
          },
          {
            libraryID: 2,
            type: "group",
            version: web ? expect.any(Number) : 4,
            clientVersion: web ? 0 : 2,
            groupID: 900,
            name: "Lab",
          },
        ]);
      }),
    );

    it.effect(
      "ItemQuery runs the root's Query Job runner on the source's database",
      () =>
        Effect.gen(function* () {
          const answer = yield* withSource(
            "",
            (reads) =>
              reads.ItemQuery({
                job: { id: "libraries", command: "zotlit:query" },
              }),
            { queryJobs: libraryQueryJobs },
          );
          expect(answer).toEqual({
            command: "zotlit:query",
            libraries: [
              { type: "user", groupID: null },
              { type: "group", groupID: 900 },
            ],
          });
        }),
    );

    it.effect(
      "QueryAnswer streams the answer of the root's Query Job runner on the source's database",
      () =>
        Effect.gen(function* () {
          const parts = yield* withSource(
            "",
            (reads) =>
              Stream.runCollect(
                reads.QueryAnswer({
                  job: { id: "libraries", command: "zotlit:query" },
                }),
              ),
            { queryJobs: libraryQueryJobs },
          );
          expect(parts).toEqual([
            {
              _tag: "Head",
              summary: {
                command: "zotlit:query",
                libraries: [
                  { type: "user", groupID: null },
                  { type: "group", groupID: 900 },
                ],
              },
            },
            { _tag: "Chunk", bytes: new TextEncoder().encode("{}") },
          ]);
        }),
    );

    it.effect("SourceIdentity names the source of the borrowed database", () =>
      Effect.gen(function* () {
        const identity = yield* withSource("", (reads) =>
          Effect.gen(function* () {
            if (!web)
              yield* reads.Configure(
                fileConfig("/zotero/zotero.sqlite", "source-1"),
              );
            return yield* reads.SourceIdentity({});
          }),
        );
        expect(identity).toEqual(
          web
            ? {
                kind: "web-api",
                id: `web-api:${WEB_API_ACCOUNT.userID}`,
                userID: WEB_API_ACCOUNT.userID,
                username: WEB_API_ACCOUNT.username,
              }
            : {
                kind: "file",
                id: "source-1",
                databasePath: "/zotero/zotero.sqlite",
              },
        );
      }),
    );

    it.effect(
      "ConnectionReadout counts top-level items across every library",
      () =>
        Effect.gen(function* () {
          const readout = yield* withSource("", (reads) =>
            reads.ConnectionReadout({}),
          );
          expect(readout).toEqual({ itemCount: 4 });
        }),
    );

    it.effect(
      "ItemsByIndexedKeys answers user and group keys and leaves unknown keys out",
      () =>
        Effect.gen(function* () {
          const items = yield* withSource("", (reads) =>
            reads.ItemsByIndexedKeys({
              indexedKeys: [
                "MAIN2345",
                "GRPITEMSg900",
                "MISS2345",
                "GRPITEMSg1",
              ],
            }),
          );
          expect([...items.keys()]).toEqual(["MAIN2345", "GRPITEMSg900"]);
          const main = items.get("MAIN2345")!;
          expect(main.dateAdded.toString()).toBe("2024-01-01T00:00:00Z");
          expect(main.customFields).toBeInstanceOf(Map);
          expect(main.fields).toMatchObject({
            itemType: "journalArticle",
            title: "Main Study",
          });
          expect(main.creators).toEqual([
            {
              firstName: "Ada",
              lastName: "Lovelace",
              creatorType: "author",
              fieldMode: 0,
            },
          ]);
          expect(items.get("GRPITEMSg900")).toMatchObject({
            libraryID: 2,
            groupID: 900,
          });
        }),
    );

    it.effect("ItemFamily returns related items and child notes", () =>
      Effect.gen(function* () {
        const [family, unknown, main] = yield* withSource("", (reads, id) =>
          Effect.all([
            reads.ItemFamily({ itemID: id("MAIN2345") }),
            reads.ItemFamily({ itemID: 999 }),
            Effect.succeed(id("MAIN2345")),
          ]),
        );
        expect(family.relatedItems.map((item) => item.key).sort()).toEqual([
          "RELA2345",
          "RELB2345",
        ]);
        expect(family.childNotes).toMatchObject([
          { key: "NTE22345", title: noteTitle, parentItemID: main },
        ]);
        expect(Schema.is(Instant)(family.childNotes[0]!.dateModified)).toBe(
          true,
        );
        expect(unknown).toEqual({ relatedItems: [], childNotes: [] });
      }),
    );

    it.effect(
      "NoteSource returns a bundle the renderer builds into the note context",
      () =>
        Effect.gen(function* () {
          const [source, missing, attachmentID] = yield* withSource(
            "",
            (reads, id) =>
              Effect.all([
                reads.NoteSource({ itemID: id("MAIN2345") }),
                reads.NoteSource({ itemID: 999 }),
                Effect.succeed(id("ATCH2345")),
              ]),
          );
          expect(missing).toBeNull();
          expect(source!.username).toBe("reader");
          expect(
            Schema.is(Instant)(
              source!.annotationsByAttachment.get(attachmentID)![0]!.dateAdded,
            ),
          ).toBe(true);

          const ctx = buildNoteContextFromSource(source!, noteResolvers);
          expect(ctx.title).toBe("Main Study");
          expect(ctx.weblink).toBe(
            "https://www.zotero.org/reader/items/MAIN2345",
          );
          expect(ctx.tags.map(String)).toEqual(["zt"]);
          expect(ctx.collections.map(String)).toEqual(["Reading"]);
          expect(ctx.attachments.map((a) => a.key)).toEqual(["ATCH2345"]);
          expect(ctx.annotations.map((a) => a.key)).toEqual([
            "ANNT2345",
            "ANNT2346",
          ]);
          expect(ctx.annotations[0]!.tags.map(String)).toEqual(["claim"]);
          expect(ctx.relatedItems.map((r) => r.title)).toEqual([
            "Alpha Paper",
            "Beta Book",
          ]);
          expect(ctx.notes.map((n) => n.key)).toEqual(["NTE22345"]);
        }),
    );

    it.effect(
      "ItemFacets streams each item's own tags and collections in request order",
      () =>
        Effect.gen(function* () {
          const [slices, ids] = yield* withSource(
            "",
            (reads, id) => {
              const ids = {
                main: id("MAIN2345"),
                book: id("RELB2345"),
                group: id("GRPITEMS"),
              };
              return Effect.all([
                Stream.runCollect(
                  reads.ItemFacets({
                    items: [
                      { itemID: ids.book, libraryID: 1 },
                      { itemID: ids.main, libraryID: 1 },
                      { itemID: ids.group, libraryID: 2 },
                      { itemID: 999, libraryID: 1 },
                    ],
                  }),
                ),
                Effect.succeed(ids),
              ]);
            },
            { sliceSize: 2 },
          );
          expect(
            slices.map((slice) =>
              slice.map(({ itemID, facets }) => ({
                itemID,
                tags: facets.tags.map(({ tag }) => tag.name),
                collections: facets.collections.map(({ name }) => name),
              })),
            ),
          ).toEqual([
            [
              { itemID: ids.book, tags: ["method"], collections: ["Reading"] },
              { itemID: ids.main, tags: ["zt"], collections: ["Reading"] },
            ],
            [
              { itemID: ids.group, tags: [], collections: [] },
              { itemID: 999, tags: [], collections: [] },
            ],
          ]);
        }),
    );

    it.effect(
      "NoteSource takes the caller's username over the signed-in account",
      () =>
        Effect.gen(function* () {
          const source = yield* withSource("", (reads, id) =>
            reads.NoteSource({ itemID: id("MAIN2345"), username: null }),
          );
          expect(source!.username).toBeNull();
        }),
    );

    it.effect(
      "AnnotationSources returns annotations by key with their attachment, parent item, and tags",
      () =>
        Effect.gen(function* () {
          const [sources, annotationID] = yield* withSource("", (reads, id) =>
            Effect.all([
              reads.AnnotationSources({
                libraryID: 1,
                keys: ["ANNT2345", "MISS2345"],
              }),
              Effect.succeed(id("ANNT2345")),
            ]),
          );
          expect(sources.annotations.map((a) => a.key)).toEqual(["ANNT2345"]);
          expect(sources.annotations[0]!.position).toEqual({
            pageIndex: 0,
            rects: [[0, 0, 1, 1]],
          });
          expect(sources.attachments.map((a) => a.key)).toEqual(["ATCH2345"]);
          expect(sources.parentItems.map((i) => i.key)).toEqual(["MAIN2345"]);
          expect(
            sources.tagsByItemID.get(annotationID)!.map((tag) => tag.tag.name),
          ).toEqual(["claim"]);
          expect(sources.username).toBe("reader");
        }),
    );

    it.effect(
      "AnnotationsOfAttachment returns the attachment's annotations and the account user",
      () =>
        Effect.gen(function* () {
          const [found, unknown] = yield* withSource("", (reads) =>
            Effect.all([
              reads.AnnotationsOfAttachment({ attachmentKey: "ATCH2345" }),
              reads.AnnotationsOfAttachment({ attachmentKey: "MISS2345" }),
            ]),
          );
          expect(found.attachment).toMatchObject({
            key: "ATCH2345",
            contentType: "application/pdf",
          });
          expect(found.annotations.map((a) => [a.key, a.type])).toEqual([
            ["ANNT2345", 1],
            ["ANNT2346", 3],
          ]);
          expect(found.accountUserID).toBe(42);
          expect(unknown).toEqual({
            attachment: null,
            annotations: [],
            accountUserID: 42,
          });
        }),
    );

    it.effect("AttachmentsOf lists the attachments of the given items", () =>
      Effect.gen(function* () {
        const [attachments, main] = yield* withSource("", (reads, id) =>
          Effect.all([
            reads.AttachmentsOf({ itemIDs: [id("MAIN2345"), id("RELB2345")] }),
            Effect.succeed(id("MAIN2345")),
          ]),
        );
        expect(attachments).toMatchObject([
          {
            key: "ATCH2345",
            parentItemID: main,
            path: "storage:paper.pdf",
            linkMode: 0,
          },
        ]);
        expect(Schema.is(Instant)(attachments[0]!.dateModified)).toBe(true);
      }),
    );

    it.effect(
      "DisplayRefs streams one entry per id, null for an id with no live item",
      () =>
        Effect.gen(function* () {
          const [slices, main, group] = yield* withSource(
            "",
            (reads, id) =>
              Effect.all([
                Stream.runCollect(
                  reads.DisplayRefs({
                    itemIDs: [id("MAIN2345"), id("GRPITEMS"), 999],
                  }),
                ),
                Effect.succeed(id("MAIN2345")),
                Effect.succeed(id("GRPITEMS")),
              ]),
            { sliceSize: 2 },
          );
          expect(slices).toEqual([
            [
              {
                itemID: main,
                ref: {
                  itemID: main,
                  libraryID: 1,
                  key: "MAIN2345",
                  groupID: null,
                  indexedKey: "MAIN2345",
                  title: "Main Study",
                },
              },
              {
                itemID: group,
                ref: {
                  itemID: group,
                  libraryID: 2,
                  key: "GRPITEMS",
                  groupID: 900,
                  indexedKey: "GRPITEMSg900",
                  title: "Group Work",
                },
              },
            ],
            [{ itemID: 999, ref: null }],
          ]);
        }),
    );

    it.effect(
      "NoteBodies returns notes with their bodies and leaves unknown keys out",
      () =>
        Effect.gen(function* () {
          const notes = yield* withSource("", (reads) =>
            reads.NoteBodies({ libraryID: 1, keys: ["NTE22345", "MISS2345"] }),
          );
          expect(notes).toMatchObject([
            {
              key: "NTE22345",
              note: web
                ? '<div class="zotero-note znv1"><p>body</p></div>'
                : "<p>body</p>",
              title: noteTitle,
            },
          ]);
          expect(Schema.is(Instant)(notes[0]!.dateAdded)).toBe(true);
        }),
    );

    it.effect("WorkLabels returns label inputs for top-level items only", () =>
      Effect.gen(function* () {
        const labels = yield* withSource("", (reads) =>
          reads.WorkLabels({
            indexedKeys: ["MAIN2345", "ATCH2345", "MISS2345"],
          }),
        );
        expect([...labels]).toEqual([
          [
            "MAIN2345",
            {
              libraryID: 1,
              creators: [
                {
                  firstName: "Ada",
                  lastName: "Lovelace",
                  creatorType: "author",
                  fieldMode: 0,
                },
              ],
              primaryCreatorType: "author",
              title: "Main Study",
              shortTitle: "Main",
              date: web ? "2024-05-06 2024-05-06" : "2024-05-06",
            },
          ],
        ]);
      }),
    );

    it.effect(
      "AttachmentPathIndex streams every attachment beside its parent key, a slice per query",
      () =>
        Effect.gen(function* () {
          const result = yield* withSource(
            `
        insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key)
          values (11, 2, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, 'ATCHSOLO');
        insert into itemAttachments (itemID, parentItemID, linkMode, path)
          values (11, null, 0, 'storage:loose.pdf');
      `,
            (reads, id) =>
              Effect.all([
                Stream.runCollect(reads.AttachmentPathIndex({})),
                Effect.succeed(id),
              ]),
            { sliceSize: 1 },
          );
          const [slices, id] = result;
          expect(
            slices.map((slice) =>
              slice.map((attachment) => [
                attachment.key,
                attachment.parentIndexedKey,
                attachment.path,
              ]),
            ),
          ).toEqual(
            [
              [["ATCH2345", "MAIN2345", "storage:paper.pdf"]],
              [["ATCHSOLO", null, "storage:loose.pdf"]],
            ].toSorted((a, b) => id(a[0]![0]!) - id(b[0]![0]!)),
          );
        }),
    );

    it.effect(
      "AttachmentsByKeys returns one library's attachments by key and leaves unknown keys out",
      () =>
        Effect.gen(function* () {
          const [found, otherLibrary, ids] = yield* withSource(
            `
        insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key)
          values (201, 2, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, 'IMGE2345');
        insert into itemAttachments (itemID, parentItemID, linkMode, contentType, path)
          values (201, 200, 0, 'image/png', 'storage:figure.png');
      `,
            (reads, id) =>
              Effect.all([
                reads.AttachmentsByKeys({
                  libraryID: 1,
                  keys: ["IMGE2345", "ATCH2345", "MISS2345"],
                }),
                reads.AttachmentsByKeys({ libraryID: 2, keys: ["IMGE2345"] }),
                Effect.succeed({ note: id("NTE22345"), main: id("MAIN2345") }),
              ]),
          );
          expect(
            found.map((a) => [a.key, a.parentItemID, a.contentType]),
          ).toEqual([
            ["IMGE2345", ids.note, "image/png"],
            ["ATCH2345", ids.main, "application/pdf"],
          ]);
          expect(Schema.is(Instant)(found[0]!.dateAdded)).toBe(true);
          expect(otherLibrary).toEqual([]);
        }),
    );

    it.effect(
      "DatabaseIdentity names the account and the Local API database",
      () =>
        Effect.gen(function* () {
          const identity = yield* withSource(
            `
        insert into settings (setting, key, value)
          values ('account', 'localUserKey', 'XmplKey8'),
                 ('localAPI', 'serverID', 'XmplSrv00Id1');
      `,
            (reads) => reads.DatabaseIdentity({}),
          );
          expect(identity).toEqual(
            web
              ? {
                  userID: 42,
                  localUserKey: expect.stringMatching(/^replica-[0-9a-z]{16}$/),
                  serverID: null,
                }
              : {
                  userID: 42,
                  localUserKey: "XmplKey8",
                  serverID: "XmplSrv00Id1",
                },
          );
        }),
    );

    it.effect(
      "ItemSnapshot exports the same Item Snapshot as a direct export",
      () =>
        Effect.gen(function* () {
          const options = {
            provenance: {
              kind: "connected",
              installationId: "install",
              vault: "Vault",
            },
            vaultTargets: { notes: { MAIN2345: "Literature/Main.md" } },
          } as const;
          const selection = {
            library: { type: "personal" },
            key: "MAIN2345",
          } as const;
          const [snapshot, replicaExport] = yield* withSource("", (reads) =>
            Effect.all([
              reads.ItemSnapshot({ selection, ...options }),
              Effect.flatMap(Connection, (connection) =>
                Effect.scoped(
                  Effect.map(connection.borrow, (client) =>
                    exportItemSnapshot(client, selection, {
                      ...options,
                      revision: snapshotRevision,
                    }),
                  ),
                ),
              ),
            ]),
          );

          const direct = createClient(":memory:");
          using _direct = { [Symbol.dispose]: () => direct.$client.close() };
          createFixtureSchema(direct.$client);
          direct.$client.exec(SEED);
          expect(snapshot).toEqual(
            web
              ? replicaExport
              : exportItemSnapshot(direct, selection, {
                  ...options,
                  revision: snapshotRevision,
                }),
          );
          expect(snapshot.item.title).toBe("Main Study");
        }),
    );

    it.effect(
      "ItemSnapshot fails with DbUnavailable for an Item outside the selected Library",
      () =>
        Effect.gen(function* () {
          const error = yield* withSource("", (reads) =>
            Effect.flip(
              reads.ItemSnapshot({
                selection: {
                  library: { type: "group", groupID: 900 },
                  key: "MAIN2345",
                },
                provenance: { kind: "sample", id: "x" },
              }),
            ),
          );
          expect(error).toBeInstanceOf(DbUnavailable);
        }),
    );

    it.effect(
      "ItemType names the type of any live Item, child Items included",
      () =>
        Effect.gen(function* () {
          const types = yield* withSource("", (reads) =>
            Effect.all([
              reads.ItemType({ indexedKey: "MAIN2345" }),
              reads.ItemType({ indexedKey: "ATCH2345" }),
              reads.ItemType({ indexedKey: "NTE22345" }),
              reads.ItemType({ indexedKey: "ANNT2345" }),
              reads.ItemType({ indexedKey: "GRPITEMSg900" }),
              reads.ItemType({ indexedKey: "MISS2345" }),
            ]),
          );
          expect(types).toEqual([
            { libraryID: 1, key: "MAIN2345", itemType: "journalArticle" },
            { libraryID: 1, key: "ATCH2345", itemType: "attachment" },
            { libraryID: 1, key: "NTE22345", itemType: "note" },
            { libraryID: 1, key: "ANNT2345", itemType: "annotation" },
            { libraryID: 2, key: "GRPITEMS", itemType: "journalArticle" },
            null,
          ]);
        }),
    );

    it.effect(
      "AnnotViewAttachments lists an item's attachments, or a standalone attachment alone, with annotation counts",
      () =>
        Effect.gen(function* () {
          const [ofItem, standalone, unknown, ids] = yield* withSource(
            `
        insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key)
          values (11, 2, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, 'LOOS2345');
        insert into itemAttachments (itemID, parentItemID, linkMode, contentType, path)
          values (11, null, 0, 'application/pdf', 'storage:loose.pdf');
      `,
            (reads, id) =>
              Effect.all([
                reads.AnnotViewAttachments({
                  libraryID: 1,
                  key: "MAIN2345",
                  standalone: false,
                }),
                reads.AnnotViewAttachments({
                  libraryID: 1,
                  key: "LOOS2345",
                  standalone: true,
                }),
                reads.AnnotViewAttachments({
                  libraryID: 1,
                  key: "MISS2345",
                  standalone: true,
                }),
                Effect.succeed({
                  attachment: id("ATCH2345"),
                  loose: id("LOOS2345"),
                }),
              ]),
          );
          expect(ofItem).toEqual([
            {
              itemID: ids.attachment,
              indexedKey: "ATCH2345",
              path: "storage:paper.pdf",
              annotCount: 2,
            },
          ]);
          expect(standalone).toEqual([
            {
              itemID: ids.loose,
              indexedKey: "LOOS2345",
              path: "storage:loose.pdf",
              annotCount: 0,
            },
          ]);
          expect(unknown).toEqual([]);
        }),
    );

    it.effect(
      "ReaderTargetKeys names a push's attachment, parent item, and live selected annotations",
      () =>
        Effect.gen(function* () {
          const [named, unknown] = yield* withSource("", (reads, id) =>
            Effect.all([
              reads.ReaderTargetKeys({
                attachmentID: id("ATCH2345"),
                selected: [id("ANNT2346"), 999],
              }),
              reads.ReaderTargetKeys({ attachmentID: 999, selected: [] }),
            ]),
          );
          expect(named).toEqual({
            attachmentKey: "ATCH2345",
            itemKey: "MAIN2345",
            selected: ["ANNT2346"],
          });
          expect(unknown).toBeNull();
        }),
    );

    it.effect(
      "ScopeItemIDs lists a library's or a collection's items or notes, null for an unknown collection",
      () =>
        Effect.gen(function* () {
          const [items, filed, notes, unknown, id] = yield* withSource(
            "",
            (reads, id) =>
              Effect.all([
                reads.ScopeItemIDs({ kind: "literature-items", libraryID: 1 }),
                reads.ScopeItemIDs({
                  kind: "literature-items",
                  libraryID: 1,
                  collectionKey: "CLL22345",
                }),
                reads.ScopeItemIDs({ kind: "notes", libraryID: 1 }),
                reads.ScopeItemIDs({
                  kind: "notes",
                  libraryID: 1,
                  collectionKey: "MISS2345",
                }),
                Effect.succeed(id),
              ]),
          );
          expect(items).toEqual(["MAIN2345", "RELA2345", "RELB2345"].map(id));
          expect(filed).toEqual(["MAIN2345", "RELB2345"].map(id));
          expect(notes).toEqual([id("NTE22345")]);
          expect(unknown).toBeNull();
        }),
    );

    it.effect(
      "ScopeItemIDs lists a whole Library newest first across scan spans, by key on a tie",
      () =>
        Effect.gen(function* () {
          const [items, id] = yield* withSource(
            `
        insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key)
          values
            (600, 1, '2024-01-01 00:00:00', '2024-03-01 00:00:00', 1, 'NEWE2345'),
            (700, 1, '2024-01-01 00:00:00', '2024-01-02 00:00:00', 1, 'AAAA2345');
      `,
            (reads, id) =>
              Effect.all([
                reads.ScopeItemIDs({ kind: "literature-items", libraryID: 1 }),
                Effect.succeed(id),
              ]),
          );
          expect(items).toEqual(
            ["NEWE2345", "MAIN2345", "RELA2345", "AAAA2345", "RELB2345"].map(
              id,
            ),
          );
        }),
    );

    it.effect(
      "NoteRefs streams one entry per id, telling a trashed note from a non-note id",
      () =>
        Effect.gen(function* () {
          const [slices, ids] = yield* withSource(
            `
        insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key)
          values (201, 3, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, 'TRSH2345');
        insert into itemNotes (itemID, parentItemID, note, title)
          values (201, null, '<p>gone</p>', 'Gone');
        insert into deletedItems (itemID) values (201);
      `,
            (reads, id) => {
              const ids = {
                note: id("NTE22345"),
                trashed: id("TRSH2345"),
                main: id("MAIN2345"),
              };
              return Effect.all([
                Stream.runCollect(
                  reads.NoteRefs({
                    itemIDs: [ids.note, ids.trashed, ids.main],
                  }),
                ),
                Effect.succeed(ids),
              ]);
            },
            { sliceSize: 2 },
          );
          expect(slices).toMatchObject([
            [
              {
                itemID: ids.note,
                note: {
                  itemID: ids.note,
                  key: "NTE22345",
                  parentItemID: ids.main,
                  title: noteTitle,
                },
                trashed: false,
              },
              { itemID: ids.trashed, note: null, trashed: true },
            ],
            [{ itemID: ids.main, note: null, trashed: false }],
          ]);
          expect(Schema.is(Instant)(slices[0]![0]!.note!.dateModified)).toBe(
            true,
          );
        }),
    );

    it.effect(
      "ChildNoteRefs streams each parent's display ref beside its child notes",
      () =>
        Effect.gen(function* () {
          const [slices, ids] = yield* withSource(
            "",
            (reads, id) => {
              const ids = {
                main: id("MAIN2345"),
                book: id("RELB2345"),
                note: id("NTE22345"),
              };
              return Effect.all([
                Stream.runCollect(
                  reads.ChildNoteRefs({ itemIDs: [ids.main, ids.book, 999] }),
                ),
                Effect.succeed(ids),
              ]);
            },
            { sliceSize: 2 },
          );
          expect(slices).toMatchObject([
            [
              {
                itemID: ids.main,
                ref: { indexedKey: "MAIN2345", title: "Main Study" },
                notes: [{ itemID: ids.note, key: "NTE22345" }],
              },
              { itemID: ids.book, ref: { indexedKey: "RELB2345" }, notes: [] },
            ],
            [{ itemID: 999, ref: null, notes: [] }],
          ]);
        }),
    );
  });

  describe(`ZoteroReads citation operations over the ${source.name} source`, () => {
    it.effect(
      "AttachmentsAt returns an attachment itself, a regular item's attachments, or nothing",
      () =>
        Effect.gen(function* () {
          const [own, children, none, attachment] = yield* withSource(
            "",
            (reads, id) =>
              Effect.all([
                reads.AttachmentsAt({ itemID: id("ATCH2345") }),
                reads.AttachmentsAt({ itemID: id("MAIN2345") }),
                reads.AttachmentsAt({ itemID: 999 }),
                Effect.succeed(id("ATCH2345")),
              ]),
          );
          expect(own).toMatchObject([{ itemID: attachment, key: "ATCH2345" }]);
          expect(children).toMatchObject([
            { itemID: attachment, key: "ATCH2345" },
          ]);
          expect(none).toEqual([]);
        }),
    );

    it.effect(
      "ItemsByIndexedKeys answers in the order of the requested keys",
      () =>
        Effect.gen(function* () {
          const items = yield* withSource("", (reads) =>
            reads.ItemsByIndexedKeys({
              indexedKeys: ["RELB2345", "GRPITEMSg900", "MISS2345", "MAIN2345"],
            }),
          );
          expect([...items.keys()]).toEqual([
            "RELB2345",
            "GRPITEMSg900",
            "MAIN2345",
          ]);
        }),
    );

    it.effect(
      "ItemsByIndexedKeys answers each key under the spelling it was asked by",
      () =>
        Effect.gen(function* () {
          const items = yield* withSource("", (reads) =>
            reads.ItemsByIndexedKeys({
              indexedKeys: ["GRPITEMSg0900", "GRPITEMSg900"],
            }),
          );
          expect([...items.keys()]).toEqual(["GRPITEMSg0900", "GRPITEMSg900"]);
          expect(items.get("GRPITEMSg0900")).toMatchObject({
            key: "GRPITEMS",
            indexedKey: "GRPITEMSg900",
          });
        }),
    );
  });

  describe(`ZoteroReads annotation-family operations over the ${source.name} source`, () => {
    it.effect(
      "AttachmentSources returns attachments by Indexed Key with their parent items, tags, and username",
      () =>
        Effect.gen(function* () {
          const [sources, main] = yield* withSource("", (reads, id) =>
            Effect.all([
              reads.AttachmentSources({
                attachmentKeys: ["ATCH2345", "MISS2345"],
              }),
              Effect.succeed(id("MAIN2345")),
            ]),
          );
          expect(sources.annotations).toEqual([]);
          expect(sources.attachments.map((a) => a.indexedKey)).toEqual([
            "ATCH2345",
          ]);
          expect(Schema.is(Instant)(sources.attachments[0]!.dateAdded)).toBe(
            true,
          );
          expect(sources.parentItems.map((i) => i.key)).toEqual(["MAIN2345"]);
          expect(
            sources.tagsByItemID.get(main)!.map((tag) => tag.tag.name),
          ).toEqual(["zt"]);
          expect(sources.username).toBe("reader");
        }),
    );
  });

  describe(`ZoteroReads Profile Match operations over the ${source.name} source`, () => {
    it.effect(
      "TagNames lists the tag names of one library, or of every library",
      () =>
        Effect.gen(function* () {
          const names = yield* withSource(
            `insert into tags (tagID, name) values (4, 'Alpha');
        insert into itemTags (itemID, tagID, type) values (300, 4, 0);`,
            (reads) =>
              Effect.all({
                user: reads.TagNames({ libraryID: 1 }),
                group: reads.TagNames({ libraryID: 2 }),
                all: reads.TagNames({}),
              }),
          );
          expect(names).toEqual({
            user: ["claim", "method", "zt"],
            group: ["Alpha"],
            all: ["Alpha", "claim", "method", "zt"],
          });
        }),
    );

    it.effect(
      "CollectionPaths lists every live collection path of the given libraries, root first",
      () =>
        Effect.gen(function* () {
          const paths = yield* withSource(
            `insert into collections (collectionID, collectionName, libraryID, key, parentCollectionID)
        values (501, 'Theory', 1, 'CLL32345', 500), (502, 'Lab Notes', 2, 'CLL42345', null);`,
            (reads) =>
              Effect.all({
                user: reads.CollectionPaths({ libraryIDs: [1] }),
                both: reads.CollectionPaths({ libraryIDs: [1, 2] }),
              }),
          );
          expect(paths).toEqual({
            user: [["Reading"], ["Reading", "Theory"]],
            both: [["Lab Notes"], ["Reading"], ["Reading", "Theory"]],
          });
        }),
    );
  });

  describe(`ZoteroReads SearchItems over the ${source.name} source`, () => {
    it.effect(
      "a search answers hydrated Items of every library, and ranks a used Item first",
      () =>
        Effect.gen(function* () {
          const everything = { libraryIDs: [1, 2], query: "", limit: 10 };
          const [all, used, titled] = yield* withSource("", (reads) =>
            Effect.all([
              reads.SearchItems(everything),
              reads.SearchItems({
                ...everything,
                limit: 1,
                uses: { RELB2345: 2208988800000 },
              }),
              reads.SearchItems({ ...everything, query: "alpha" }),
            ]),
          );
          expect(all.map((hit) => hit.item.indexedKey)).toEqual([
            "GRPITEMSg900",
            "MAIN2345",
            "RELA2345",
            "RELB2345",
          ]);
          expect(Schema.is(Instant)(all[0]!.item.dateAdded)).toBe(true);
          expect(used.map((hit) => hit.item.indexedKey)).toEqual(["RELB2345"]);
          expect(titled.map((hit) => hit.item.indexedKey)).toEqual([
            "RELA2345",
          ]);
        }),
    );
  });
}

describe("SourceIdentity over the Zotero file source", () => {
  it.effect(
    "keeps its client when only the source ID of the configuration changes, as the desktop source does",
    () =>
      Effect.gen(function* () {
        const fixture = fixtureOpener();
        const identity = yield* withReads(fixture.open, (reads) =>
          Effect.gen(function* () {
            yield* reads.Configure(
              fileConfig("/zotero/zotero.sqlite", "source-1"),
            );
            yield* reads.Configure(
              fileConfig("/zotero/zotero.sqlite", "source-2"),
            );
            return yield* reads.SourceIdentity({});
          }),
        );
        expect(fixture.log.filter((line) => line.startsWith("open"))).toEqual([
          "open #1",
        ]);
        expect(identity).toEqual({
          kind: "file",
          id: "source-2",
          databasePath: "/zotero/zotero.sqlite",
        });
      }),
  );

  it.effect(
    "gives no path and no source ID for a client that opened before the first configuration",
    () =>
      Effect.gen(function* () {
        const connection = yield* Connection;
        const client = yield* connection.borrow;
        yield* connection.configure(
          fileConfig("/zotero/zotero.sqlite", "source-1"),
        );
        expect(yield* connection.identity(client)).toEqual({
          kind: "file",
          id: null,
          databasePath: null,
        });
      }).pipe(Effect.scoped, Effect.provide(layerRcRef(fixtureOpener().open))),
  );

  it.effect(
    "gives no source ID while the Worker serves a database that the preferences no longer name",
    () =>
      Effect.gen(function* () {
        const identity = yield* withReads(
          fixtureOpener((open) => (open === 1 ? "" : null)).open,
          (reads) =>
            Effect.gen(function* () {
              yield* reads.Configure(
                fileConfig("/zotero/zotero.sqlite", "source-1"),
              );
              yield* reads.Configure(
                fileConfig("/moved/zotero.sqlite", "source-2"),
              );
              return yield* reads.SourceIdentity({});
            }),
        );
        expect(identity).toEqual({
          kind: "file",
          id: null,
          databasePath: "/zotero/zotero.sqlite",
        });
      }),
  );
});

describeReadOperations(fileSource);
describeReadOperations(webApiSource);

describe("ZoteroReads operations on the file source", () => {
  const sliceIDs = { one: [200], many: [1, 2, 3, 10, 200, 201, 999] };
  type SliceRead = [
    string,
    (
      reads: ZoteroReadsClient,
      size: "one" | "many",
    ) => Effect.Effect<unknown, unknown>,
  ];
  const sliceOpener = () =>
    fixtureOpener(
      () => `
        insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key)
          values (201, 3, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, 'TRSH2345'),
                 (202, 3, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, 'NTE32345'),
                 (11, 2, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, 'ATC22345'),
                 (12, 2, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, 'ATC32345'),
                 (13, 2, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, 'TRSA2345');
        insert into itemNotes (itemID, parentItemID, note, title)
          values (201, 1, '<p>gone</p>', 'Gone'), (202, 2, '<p>more</p>', 'More');
        insert into itemAttachments (itemID, parentItemID, linkMode, contentType, path)
          values (11, 2, 0, 'application/pdf', 'storage:beta.pdf'),
                 (12, 1, 0, 'application/pdf', 'storage:main-2.pdf'),
                 (13, 1, 0, 'application/pdf', 'storage:gone.pdf');
        insert into deletedItems (itemID) values (201), (13);
      `,
    );
  const sliceReads: SliceRead[] = [
    [
      "DisplayRefs",
      (reads, size) =>
        Stream.runDrain(reads.DisplayRefs({ itemIDs: sliceIDs[size] })),
    ],
    [
      "NoteRefs",
      (reads, size) =>
        Stream.runDrain(reads.NoteRefs({ itemIDs: sliceIDs[size] })),
    ],
    [
      "ChildNoteRefs",
      (reads, size) =>
        Stream.runDrain(reads.ChildNoteRefs({ itemIDs: sliceIDs[size] })),
    ],
    [
      "NoteBodies",
      (reads, size) =>
        reads.NoteBodies({
          libraryID: 1,
          keys:
            size === "one"
              ? ["NTE22345"]
              : ["NTE22345", "NTE32345", "TRSH2345", "MISS2345", "NTE22345"],
        }),
    ],
    [
      "ItemsByIndexedKeys",
      (reads, size) =>
        reads.ItemsByIndexedKeys({
          indexedKeys:
            size === "one"
              ? ["MAIN2345"]
              : ["MAIN2345", "RELB2345", "RELA2345", "ATCH2345", "MISS2345"],
        }),
    ],
    [
      "AttachmentsOf",
      (reads, size) =>
        reads.AttachmentsOf({
          itemIDs: size === "one" ? [2] : [1, 2, 3, 999, 1],
        }),
    ],
    [
      "AnnotationSources",
      (reads, size) =>
        reads.AnnotationSources({
          libraryID: 1,
          keys:
            size === "one"
              ? ["ANNT2345"]
              : ["ANNT2345", "MISS2345", "ANNT2345"],
        }),
    ],
    [
      "AttachmentsByKeys",
      (reads, size) =>
        reads.AttachmentsByKeys({
          libraryID: 1,
          keys:
            size === "one"
              ? ["ATCH2345"]
              : ["ATCH2345", "ATC22345", "ATC32345", "TRSA2345", "MISS2345"],
        }),
    ],
    [
      "AttachmentSources",
      (reads, size) =>
        reads.AttachmentSources({
          attachmentKeys:
            size === "one"
              ? ["ATCH2345"]
              : ["ATCH2345", "ATC22345", "ATC32345", "TRSA2345", "MISS2345"],
        }),
    ],
  ];
  const uncachedReads = new Set(["DisplayRefs", "NoteRefs", "ChildNoteRefs"]);
  it.effect.each(sliceReads)(
    "%s runs the same statements for one row as for many",
    ([_operation, read]) =>
      Effect.gen(function* () {
        const { open, statements } = sliceOpener();
        const counts = yield* withReads(open, (reads) =>
          Effect.gen(function* () {
            const cost = (size: "one" | "many") =>
              Effect.gen(function* () {
                const before = statements();
                yield* read(reads, size);
                return statements() - before;
              });
            yield* cost("one");
            yield* cost("many");
            return { one: yield* cost("one"), many: yield* cost("many") };
          }),
        );
        expect(counts.many).toBe(counts.one);
      }),
  );
  it.effect.each(
    sliceReads.filter(([operation]) => !uncachedReads.has(operation)),
  )(
    "%s compiles no statement for a warm read of one row or many",
    ([_operation, read]) =>
      Effect.gen(function* () {
        const { open, compiles } = sliceOpener();
        const counts = yield* withReads(open, (reads) =>
          Effect.gen(function* () {
            const cost = (size: "one" | "many") =>
              Effect.gen(function* () {
                const before = compiles();
                yield* read(reads, size);
                return compiles() - before;
              });
            yield* cost("one");
            yield* cost("many");
            return [yield* cost("one"), yield* cost("many")];
          }),
        );
        expect(counts).toEqual([0, 0]);
      }),
  );

  const fiftyKeys = (live: string[], suffix: string) => {
    const alphabet = "23456789ABCDEFGHIJKLMNPQRSTUVWXYZ";
    const misses = Array.from(
      { length: 50 - live.length - 1 },
      (_, i) => `MISS22${alphabet[Math.floor(i / 33)]}${alphabet[i % 33]}`,
    );
    return [...live, ...misses, live[0]!].map((key) => `${key}${suffix}`);
  };
  const userFifty = fiftyKeys(["MAIN2345", "RELA2345", "RELB2345"], "");
  const groupFifty = fiftyKeys(["GRPITEMS"], "g900");

  const keyReadCosts = (
    requests: (readonly string[])[],
    counter: "statements" | "compiles" = "statements",
  ) => {
    const opener = fixtureOpener();
    const { open } = opener;
    const count = opener[counter];
    return withReads(open, (reads) =>
      Effect.gen(function* () {
        const cost = (indexedKeys: readonly string[]) =>
          Effect.gen(function* () {
            const before = count();
            yield* reads.ItemsByIndexedKeys({ indexedKeys });
            return count() - before;
          });
        for (const request of requests) yield* cost(request);
        const costs: number[] = [];
        for (const request of requests) costs.push(yield* cost(request));
        return costs;
      }),
    );
  };

  it.effect.each([
    ["the user Library", ["MAIN2345"], userFifty],
    ["a group Library", ["GRPITEMSg900"], groupFifty],
  ] as const)(
    "ItemsByIndexedKeys runs the same cached statements for one key of %s as for fifty",
    ([_library, one, fifty]) =>
      Effect.gen(function* () {
        expect(fifty).toHaveLength(50);
        const [oneCost, fiftyCost] = yield* keyReadCosts([one, fifty]);
        expect(fiftyCost).toBe(oneCost);
        expect(yield* keyReadCosts([one, fifty], "compiles")).toEqual([0, 0]);
      }),
  );

  it.effect(
    "ItemsByIndexedKeys keys spanning two Libraries run each Library's statements once",
    () =>
      Effect.gen(function* () {
        const [user, group, both] = yield* keyReadCosts([
          ["MAIN2345"],
          ["GRPITEMSg900"],
          [...userFifty, ...groupFifty],
        ]);
        expect(both).toBe(user! + group!);
        expect(user).toBe(1);
      }),
  );

  it.effect("a source that cannot open fails with a tagged DbUnavailable", () =>
    Effect.gen(function* () {
      const { open } = fixtureOpener(() => null);
      const error = yield* withReads(open, (reads) =>
        Effect.flip(reads.Libraries({})),
      );
      expect(error).toBeInstanceOf(DbUnavailable);
      expect(error).toMatchObject({
        _tag: "DbUnavailable",
        message: "source #1 is not readable",
      });
    }),
  );
});

describe("ZoteroReads connection lifetime", () => {
  it.effect("Changes starts with the current state and reports a refresh", () =>
    Effect.gen(function* () {
      const { open, log } = fixtureOpener();
      const events = yield* withReads(open, (reads) =>
        Effect.gen(function* () {
          yield* reads.Libraries({});
          const changes = yield* Stream.toPull(reads.Changes());
          const seed = yield* take(changes, 1);
          yield* reads.Refresh();
          return [...seed, ...(yield* take(changes, 3))];
        }).pipe(Effect.scoped),
      );
      expect(events).toEqual<ChangeEvent[]>([
        { _tag: "state", state: "ready", error: null },
        { _tag: "refreshing", active: true },
        { _tag: "changed" },
        { _tag: "refreshing", active: false },
      ]);
      expect(log).toEqual(["open #1", "open #2", "close #1", "close #2"]);
    }),
  );

  it.effect(
    "a subscriber that joins before the first read sees the connection open",
    () =>
      Effect.gen(function* () {
        const { open } = fixtureOpener();
        const events = yield* withReads(open, (reads) =>
          Effect.gen(function* () {
            const changes = yield* Stream.toPull(reads.Changes());
            const seed = yield* take(changes, 1);
            yield* reads.Libraries({});
            return [...seed, ...(yield* take(changes, 1))];
          }).pipe(Effect.scoped),
        );
        expect(events).toEqual<ChangeEvent[]>([
          { _tag: "state", state: "loading", error: null },
          { _tag: "changed" },
        ]);
      }),
  );

  it.effect(
    "a subscriber that joins before the first read sees a source that cannot open degrade",
    () =>
      Effect.gen(function* () {
        const { open } = fixtureOpener(() => null);
        const events = yield* withReads(open, (reads) =>
          Effect.gen(function* () {
            const changes = yield* Stream.toPull(reads.Changes());
            const seed = yield* take(changes, 1);
            yield* Effect.flip(reads.Libraries({}));
            yield* Effect.flip(reads.Libraries({}));
            return [...seed, ...(yield* take(changes, 1))];
          }).pipe(Effect.scoped),
        );
        expect(events.map((event) => event._tag)).toEqual([
          "state",
          "degraded",
        ]);
        expect(events[1]).toHaveProperty(
          "error.message",
          "source #1 is not readable",
        );
      }),
  );

  it.effect(
    "a refresh whose new source fails validation keeps the current connection serving",
    () =>
      Effect.gen(function* () {
        const { open, log } = fixtureOpener((id) =>
          id === 2 ? "drop table libraries;" : "",
        );
        const result = yield* withReads(open, (reads) =>
          Effect.gen(function* () {
            const before = yield* connectionSeen(reads);
            const changes = yield* Stream.toPull(reads.Changes());
            const seed = yield* take(changes, 1);
            const refresh = yield* Effect.flip(reads.Refresh());
            const after = yield* connectionSeen(reads);
            const rest = yield* take(changes, 3);
            return { before, refresh, after, events: [...seed, ...rest] };
          }).pipe(Effect.scoped),
        );
        expect(result.before).toBe(1);
        expect(result.after).toBe(1);
        expect(result.refresh).toMatchObject({ _tag: "DbUnavailable" });
        expect(result.events.map((event) => event._tag)).toEqual([
          "state",
          "refreshing",
          "refresh-failed",
          "refreshing",
        ]);
        expect(result.events[2]).toMatchObject({
          error: { _tag: "DbUnavailable" },
        });
        expect(result.events[2]!).toHaveProperty(
          "error.message",
          expect.stringContaining("This file is not a Zotero database."),
        );
        expect(log).toEqual(["open #1", "open #2", "close #2", "close #1"]);
      }),
  );

  it.effect(
    "a Snapshot keeps its connection across a refresh; the old one closes when the Snapshot ends",
    () =>
      Effect.gen(function* () {
        const { open, log, closed } = fixtureOpener();
        const seen = yield* withReads(open, (reads) =>
          Effect.gen(function* () {
            const held = yield* Effect.scoped(
              Effect.gen(function* () {
                const pull = yield* Stream.toPull(reads.Snapshot());
                const [id] = yield* take(pull, 1);
                yield* reads.Refresh();
                const pinned = yield* connectionSeen(reads, id);
                const current = yield* connectionSeen(reads);
                return { pinned, current, log: [...log] };
              }),
            );
            yield* closed(1);
            return held;
          }),
        );
        expect(seen).toEqual({
          pinned: 1,
          current: 2,
          log: ["open #1", "open #2"],
        });
      }),
  );

  it.effect(
    "NoteSource reuses one Snapshot's tag, collection, and account lookups across reads",
    () =>
      Effect.gen(function* () {
        const { open, statements } = fixtureOpener();
        const counts = yield* withReads(open, (reads) =>
          Effect.gen(function* () {
            const cost = (read: Effect.Effect<unknown, unknown>) =>
              Effect.gen(function* () {
                const before = statements();
                yield* read;
                return statements() - before;
              });
            const unbound = [
              yield* cost(reads.NoteSource({ itemID: 1 })),
              yield* cost(reads.NoteSource({ itemID: 1 })),
            ];
            const pinned = yield* Effect.scoped(
              Effect.gen(function* () {
                const pull = yield* Stream.toPull(reads.Snapshot());
                const [snapshot] = yield* take(pull, 1);
                return [
                  yield* cost(reads.NoteSource({ itemID: 1, snapshot })),
                  yield* cost(reads.NoteSource({ itemID: 1, snapshot })),
                ];
              }),
            );
            return { unbound, pinned };
          }),
        );
        expect(counts.pinned[1]).toBeLessThan(counts.unbound[1]!);
      }),
  );

  it.effect(
    "a Snapshot-bound stream keeps reading its connection after a swap and holds it until the stream ends",
    () =>
      Effect.gen(function* () {
        const { open, log, closed } = fixtureOpener((id) =>
          id === 2 ? "delete from items where itemID = 3;" : "",
        );
        const result = yield* withReads(
          open,
          (reads) =>
            Effect.gen(function* () {
              const snapshotScope = yield* Scope.make();
              const snapshot = yield* Stream.toPull(reads.Snapshot()).pipe(
                Scope.provide(snapshotScope),
              );
              const [id] = yield* take(snapshot, 1);

              const streamed = yield* Effect.scoped(
                Effect.gen(function* () {
                  const slices = yield* Stream.toPull(
                    reads.DisplayRefs(
                      { itemIDs: [1, 1, 1, 1, 3], snapshot: id },
                      { streamBufferSize: 1 },
                    ),
                  );
                  const first = yield* take(slices, 1);
                  yield* reads.Refresh();
                  const indexed = yield* reads.ItemsByIndexedKeys({
                    indexedKeys: ["MAIN2345", "RELA2345", "RELB2345"],
                    snapshot: id,
                  });

                  yield* Scope.close(snapshotScope, Exit.void);
                  yield* reads
                    .Libraries({ snapshot: id })
                    .pipe(Effect.flip, Effect.retry({ times: 100 }));
                  const logAfterSnapshotEnd = [...log];

                  const rest = yield* take(slices, 4);
                  return {
                    refs: [...first, ...rest].flat(),
                    indexed: [...indexed.keys()],
                    logAfterSnapshotEnd,
                  };
                }),
              );
              yield* closed(1);
              return streamed;
            }),
          { sliceSize: 1 },
        );
        expect(result.refs.at(-1)).toMatchObject({
          itemID: 3,
          ref: { key: "RELA2345" },
        });
        expect(result.indexed).toEqual(["MAIN2345", "RELA2345", "RELB2345"]);
        expect(result.logAfterSnapshotEnd).toEqual(["open #1", "open #2"]);
      }),
  );

  it.effect(
    "a read naming an unknown Snapshot fails with SnapshotExpired",
    () =>
      Effect.gen(function* () {
        const { open } = fixtureOpener();
        const error = yield* withReads(open, (reads) =>
          Effect.flip(
            reads.Libraries({ snapshot: SnapshotId.make("snapshot-404") }),
          ),
        );
        expect(error).toBeInstanceOf(SnapshotExpired);
        expect(error).toMatchObject({
          _tag: "SnapshotExpired",
          snapshot: "snapshot-404",
        });
      }),
  );

  it.effect(
    "a held Snapshot stays readable however long it is quiet, and ending its stream releases its connection",
    () =>
      Effect.gen(function* () {
        const { open, closed } = fixtureOpener();
        const result = yield* Effect.gen(function* () {
          const reads = yield* makeInProcessClient({ snapshotRevision });
          const snapshotScope = yield* Scope.make();
          const pull = yield* Stream.toPull(reads.Snapshot()).pipe(
            Scope.provide(snapshotScope),
          );
          const [id] = yield* take(pull, 1);
          yield* reads.Refresh();

          yield* TestClock.adjust("1 day");
          const afterADay = yield* connectionSeen(reads, id);

          yield* Scope.close(snapshotScope, Exit.void);
          yield* closed(1);
          const expired = yield* reads
            .Libraries({ snapshot: id })
            .pipe(Effect.flip, Effect.retry({ times: 100 }));
          return { afterADay, expired };
        }).pipe(
          Effect.scoped,
          Effect.provide([layerRcRef(open), NodeFileSystem.layer]),
        );
        expect(result.afterADay).toBe(1);
        expect(result.expired).toBeInstanceOf(SnapshotExpired);
      }),
  );

  it.effect("a request completes while a stream is open", () =>
    Effect.gen(function* () {
      const { open } = fixtureOpener();
      const order = yield* withReads(
        open,
        (reads) =>
          Effect.gen(function* () {
            const order: string[] = [];
            const slices = yield* Stream.toPull(
              reads.DisplayRefs(
                { itemIDs: Array.from({ length: 10 }, () => 1) },
                { streamBufferSize: 1 },
              ),
            );
            yield* take(slices, 1);
            order.push("first slice");
            yield* reads.Libraries({});
            order.push("libraries");
            yield* take(slices, 9);
            order.push("stream drained");
            return order;
          }).pipe(Effect.scoped),
        { sliceSize: 1 },
      );
      expect(order).toEqual(["first slice", "libraries", "stream drained"]);
    }),
  );

  it.effect(
    "interrupting a stream stops its reads and releases its borrow",
    () =>
      Effect.gen(function* () {
        const { open, closed, statements } = fixtureOpener();
        const result = yield* withReads(
          open,
          (reads) =>
            Effect.gen(function* () {
              yield* reads.Libraries({});
              const before = statements();
              const first = yield* Stream.runCollect(
                Stream.take(
                  reads.DisplayRefs(
                    { itemIDs: Array.from({ length: 50 }, () => 1) },
                    { streamBufferSize: 1 },
                  ),
                  1,
                ),
              );
              yield* reads.Refresh();
              yield* closed(1);
              return { first, ran: statements() - before };
            }),
          { sliceSize: 1 },
        );
        expect(result.first).toHaveLength(1);
        expect(result.ran).toBeLessThan(10);
      }),
  );

  it.effect(
    "a stream read through the service reads no slice ahead of its consumer",
    () =>
      Effect.gen(function* () {
        const { open, statements } = fixtureOpener();
        const service = yield* Effect.acquireDisposable(
          Effect.tryPromise(async () =>
            inProcessReadsService(open, {
              handlers: { sliceSize: 1 },
            }),
          ),
        );
        const { reads } = yield* Effect.promise(() => service.ready);
        const { oneSlice, held } = yield* Effect.gen(function* () {
          const cost = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
            Effect.gen(function* () {
              const before = statements();
              yield* effect;
              return statements() - before;
            });
          const items = Array.from({ length: 50 }, () => 1);
          yield* Stream.runDrain(reads.DisplayRefs({ itemIDs: [1] }));
          const oneSlice = yield* cost(
            Stream.runDrain(reads.DisplayRefs({ itemIDs: [1] })),
          );
          const roundTrips = Effect.gen(function* () {
            for (let i = 0; i < 20; i++) yield* reads.Libraries({});
          });
          const alone = yield* cost(roundTrips);
          const held = yield* cost(
            Effect.gen(function* () {
              const slices = yield* Stream.toPull(
                reads.DisplayRefs({ itemIDs: items }),
              );
              yield* take(slices, 1);
              yield* roundTrips;
            }),
          );
          return { oneSlice, held: held - alone };
        }).pipe(Effect.scoped);
        expect(held).toBeLessThanOrEqual(2 * oneSlice);
      }),
  );

  it.effect(
    "Configure hands the new settings to the opener and swaps the connection",
    () =>
      Effect.gen(function* () {
        const { open, configs } = fixtureOpener();
        const config: ReadsConfig = {
          databasePath: "/Zotero/zotero.sqlite",
          readMode: "immutable",
          autoRefresh: true,
          locale: null,
          chineseSegmenter: null,
          logLevel: null,
        };
        const seen = yield* withReads(open, (reads) =>
          Effect.gen(function* () {
            yield* reads.Libraries({});
            yield* reads.Configure(config);
            return yield* connectionSeen(reads);
          }),
        );
        expect(configs).toEqual([null, config]);
        expect(seen).toBe(2);
      }),
  );

  it.effect("NotifyExternalChange refreshes the connection", () =>
    Effect.gen(function* () {
      const { open } = fixtureOpener();
      const seen = yield* withReads(open, (reads) =>
        Effect.gen(function* () {
          yield* reads.Libraries({});
          yield* reads.NotifyExternalChange();
          return yield* connectionSeen(reads);
        }),
      );
      expect(seen).toBe(2);
    }),
  );
});

describe("Connection databaseGeneration", () => {
  const generationNow = Effect.scoped(
    Effect.gen(function* () {
      const connection = yield* Connection;
      return connection.databaseGeneration(yield* connection.borrow);
    }),
  );

  it.effect(
    "a refresh of the same database keeps the generation for the new client",
    () =>
      Effect.gen(function* () {
        const { open } = fixtureOpener();
        const result = yield* withReads(open, (reads) =>
          Effect.gen(function* () {
            const before = yield* generationNow;
            yield* reads.Refresh();
            return {
              before,
              after: yield* generationNow,
              seen: yield* connectionSeen(reads),
            };
          }),
        );
        expect(result.seen).toBe(2);
        expect(result.before).toBe(1);
        expect(result.after).toBe(1);
      }),
  );

  it.effect(
    "a Configure to another database file gives the next client a higher generation",
    () =>
      Effect.gen(function* () {
        const { open } = fixtureOpener();
        const other: ReadsConfig = {
          databasePath: "/Backup/zotero.sqlite",
          readMode: "auto",
          autoRefresh: true,
          locale: null,
          chineseSegmenter: null,
          logLevel: null,
        };
        const result = yield* withReads(open, (reads) =>
          Effect.gen(function* () {
            const before = yield* generationNow;
            yield* reads.Configure(other);
            return {
              before,
              after: yield* generationNow,
              seen: yield* connectionSeen(reads),
            };
          }),
        );
        expect(result.seen).toBe(2);
        expect(result.after).toBeGreaterThan(result.before);
      }),
  );

  it.effect(
    "another database at the same path gives the next client a higher generation",
    () =>
      Effect.gen(function* () {
        const { open } = fixtureOpener((id) =>
          id === 2
            ? "insert into settings (setting, key, value) values ('account', 'localUserKey', 'OTHERDB2');"
            : id === 3
              ? "update settings set value = 43 where setting = 'account' and key = 'userID';"
              : "",
        );
        const result = yield* withReads(open, (reads) =>
          Effect.gen(function* () {
            const first = yield* generationNow;
            yield* reads.Refresh();
            const second = yield* generationNow;
            yield* reads.Refresh();
            return {
              first,
              second,
              third: yield* generationNow,
              seen: yield* connectionSeen(reads),
            };
          }),
        );
        expect(result.seen).toBe(3);
        expect(result.second).toBeGreaterThan(result.first);
        expect(result.third).toBeGreaterThan(result.second);
      }),
  );
});

describe("ZoteroReads SearchItems", () => {
  const costOf =
    (statements: () => number) =>
    <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      Effect.gen(function* () {
        const before = statements();
        const value = yield* effect;
        return { value, cost: statements() - before };
      });

  const everything = { libraryIDs: [1, 2], query: "", limit: 10 };
  const inLibrary = (libraryID: number, query = "") => ({
    libraryIDs: [libraryID],
    query,
    limit: 10,
  });
  const keysOf = (hits: readonly { item: { indexedKey: string } }[]) =>
    hits.map((hit) => hit.item.indexedKey);

  const connect = (reads: ZoteroReadsClient) => reads.Libraries({});

  function sqlOf(query: (client: NodeDatabaseClient) => unknown): string {
    const client = createClient(":memory:");
    const sqlite = client.$client;
    try {
      createFixtureSchema(sqlite);
      const prepare = sqlite.prepare.bind(sqlite);
      let seen = "";
      sqlite.prepare = (source: string) => {
        seen = source;
        return prepare(source);
      };
      query(client);
      return seen;
    } finally {
      sqlite.close();
    }
  }
  const ID_READ = sqlOf((client) =>
    getIndexedItemRowsRange(client, 1, { from: 0, to: 500 }),
  );
  const SIGNATURE_READ = sqlOf((client) =>
    getIndexSignatureRange(client, 1, { from: 0, to: 1 }),
  );

  const eventually = <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    accept: (value: A) => boolean,
  ) =>
    Effect.gen(function* () {
      for (let tries = 0; tries < 500; tries++) {
        const value = yield* effect;
        if (accept(value)) return value;
        yield* TestClock.adjust("1 millis");
      }
      return yield* Effect.die(new Error("condition never held"));
    });

  const controlledConnection = (opener: ConnectionOpener) => {
    let failure: DbUnavailable | null = null;
    let publish: (event: ChangeEvent) => Effect.Effect<void> = () =>
      Effect.void;
    const gate = Latch.makeUnsafe(true);
    const arrived = Latch.makeUnsafe(false);
    const layer = Layer.effect(Connection)(
      Effect.gen(function* () {
        const base = yield* Connection;
        const extra = yield* PubSub.unbounded<ChangeEvent>();
        publish = (event) => PubSub.publish(extra, event).pipe(Effect.asVoid);
        return Connection.of({
          ...base,
          borrow: Effect.andThen(
            Effect.andThen(arrived.open, gate.await),
            Effect.suspend(() =>
              failure ? Effect.fail(failure) : base.borrow,
            ),
          ),
          changes: Stream.merge(base.changes, Stream.fromPubSub(extra)),
        });
      }),
    ).pipe(Layer.provide(layerRcRef(opener)));
    const degrade = Effect.suspend(() => {
      failure = new DbUnavailable({ message: "database gone" });
      return publish({ _tag: "degraded", error: failure });
    });
    return {
      layer,
      degrade,
      holdBorrows: Effect.andThen(gate.close, arrived.close),
      releaseBorrows: gate.open,
      borrowHeld: arrived.await,
    };
  };

  const withConnection = <A, E>(
    connection: Layer.Layer<Connection>,
    body: (reads: ZoteroReadsClient) => Effect.Effect<A, E, Scope.Scope>,
  ): Effect.Effect<A, E> =>
    Effect.gen(function* () {
      const reads = yield* makeInProcessClient({ snapshotRevision });
      return yield* body(reads);
    }).pipe(Effect.scoped, Effect.provide([connection, NodeFileSystem.layer]));

  it.effect(
    "the first search builds the index and answers hydrated Items; later searches reuse it",
    () =>
      Effect.gen(function* () {
        const { open, statements } = fixtureOpener();
        const cost = costOf(statements);
        const result = yield* withReads(open, (reads) =>
          Effect.gen(function* () {
            const first = yield* cost(reads.SearchItems(everything));
            const second = yield* cost(reads.SearchItems(everything));
            const third = yield* cost(reads.SearchItems(everything));
            const used = yield* cost(
              reads.SearchItems({
                ...everything,
                limit: 1,
                uses: { RELB2345: 2208988800000 },
              }),
            );
            return { first, second, third, used };
          }),
        );
        expect(result.first.value.map((hit) => hit.item.indexedKey)).toEqual([
          "GRPITEMSg900",
          "MAIN2345",
          "RELA2345",
          "RELB2345",
        ]);
        expect(Schema.is(Instant)(result.first.value[0]!.item.dateAdded)).toBe(
          true,
        );
        expect(result.second.value).toEqual(result.first.value);
        expect(result.first.cost).toBeGreaterThan(result.second.cost);
        expect(result.third.cost).toBe(result.second.cost);
        expect(result.used.value.map((hit) => hit.item.indexedKey)).toEqual([
          "RELB2345",
        ]);
        expect(result.used.cost).toBeLessThanOrEqual(result.second.cost);
      }),
  );

  it.effect("two parallel first searches share one build", () =>
    Effect.gen(function* () {
      const { open, ran } = fixtureOpener();
      const [a, b] = yield* withReads(open, (reads) =>
        Effect.all(
          [reads.SearchItems(everything), reads.SearchItems(everything)],
          { concurrency: "unbounded" },
        ),
      );
      expect(keysOf(b)).toEqual(keysOf(a));
      expect(a).toHaveLength(4);
      expect(ran(ID_READ)).toBe(2);
    }),
  );

  it.effect(
    "a refresh of the same database with equal signatures keeps the index",
    () =>
      Effect.gen(function* () {
        const { open, ran, closed } = fixtureOpener((id) =>
          id === 1
            ? ""
            : "update itemDataValues set value = 'Quagga Study' where valueID = 1;",
        );
        const result = yield* withReads(open, (reads) =>
          Effect.gen(function* () {
            yield* connect(reads);
            yield* reads.SearchItems(everything);
            yield* reads.Refresh();
            yield* reads.SearchItems(everything);
            yield* reads.Refresh();
            yield* closed(2);
            return {
              signatures: ran(SIGNATURE_READ, 2),
              builds: ran(ID_READ, 2),
              renamed: yield* reads.SearchItems({
                ...everything,
                query: "quagga",
              }),
            };
          }),
        );
        expect(result.signatures).toBeGreaterThan(0);
        expect(result.builds).toBe(0);
        expect(result.renamed).toEqual([]);
      }),
  );

  it.effect(
    "a refresh finds a renamed Item whose client modification time changed",
    () =>
      Effect.gen(function* () {
        const { open, closed } = fixtureOpener((id) =>
          id === 1
            ? "update items set clientDateModified = '2024-02-01 00:00:00' where itemID = 1;"
            : `
              update items set clientDateModified = '2024-02-02 00:00:00'
                where itemID = 1;
              insert into itemDataValues (valueID, value) values (8, 'Quagga Study');
              update itemData set valueID = 8 where itemID = 1 and fieldID = 10;
            `,
        );
        const renamed = yield* withReads(open, (reads) =>
          Effect.gen(function* () {
            yield* reads.SearchItems(inLibrary(1));
            yield* reads.Refresh();
            yield* closed(1);
            return yield* reads.SearchItems(inLibrary(1, "quagga"));
          }),
        );
        expect(keysOf(renamed)).toEqual(["MAIN2345"]);
        expect(renamed[0]!.item.fields).toMatchObject({
          title: "Quagga Study",
        });
      }),
  );

  it.effect(
    "a refresh to another database file whose Libraries have equal local ids rebuilds",
    () =>
      Effect.gen(function* () {
        const { open } = fixtureOpener((id) =>
          id === 1
            ? ""
            : `insert into settings (setting, key, value) values ('account', 'localUserKey', 'OTHERDB${id}');
           update itemDataValues set value = 'Quagga Study' where valueID = 1;`,
        );
        const renamed = yield* withReads(open, (reads) =>
          Effect.gen(function* () {
            yield* connect(reads);
            yield* reads.SearchItems(everything);
            yield* reads.Refresh();
            return yield* eventually(
              reads.SearchItems({ ...everything, query: "quagga" }),
              (hits) => hits.length > 0,
            );
          }),
        );
        expect(keysOf(renamed)).toEqual(["MAIN2345"]);
        expect(renamed[0]!.item.fields).toMatchObject({
          title: "Quagga Study",
        });
      }),
  );

  it.effect(
    "a Configure that points to another database file rebuilds, also with equal ids and signatures",
    () =>
      Effect.gen(function* () {
        const { open } = fixtureOpener((id) =>
          id === 1
            ? ""
            : "update itemDataValues set value = 'Quagga Study' where valueID = 1;",
        );
        const renamed = yield* withReads(open, (reads) =>
          Effect.gen(function* () {
            yield* connect(reads);
            yield* reads.SearchItems(everything);
            yield* reads.Configure({
              databasePath: "/Backup/zotero.sqlite",
              readMode: "auto",
              autoRefresh: true,
              locale: null,
              chineseSegmenter: null,
              logLevel: null,
            });
            return yield* eventually(
              reads.SearchItems({ ...everything, query: "quagga" }),
              (hits) => hits.length > 0,
            );
          }),
        );
        expect(keysOf(renamed)).toEqual(["MAIN2345"]);
      }),
  );

  it.effect("a hit whose Item vanished since the build is left out", () =>
    Effect.gen(function* () {
      const client = createClient(":memory:");
      createFixtureSchema(client.$client);
      client.$client.exec(SEED);
      const answers = yield* withConnection(
        layerRcRef(sharedClientOpener(client)),
        (reads) =>
          Effect.gen(function* () {
            const before = yield* reads.SearchItems(inLibrary(1));
            client.$client.exec(
              "delete from itemData where itemID = 3; delete from items where itemID = 3;",
            );
            const after = yield* reads.SearchItems(inLibrary(1));
            return { before, after };
          }),
      ).pipe(Effect.ensuring(Effect.sync(() => client.$client.close())));
      expect(keysOf(answers.before)).toEqual([
        "MAIN2345",
        "RELA2345",
        "RELB2345",
      ]);
      expect(keysOf(answers.after)).toEqual(["MAIN2345", "RELB2345"]);
    }),
  );

  it.effect("a degraded connection fails the search with DbUnavailable", () =>
    Effect.gen(function* () {
      const { open } = fixtureOpener();
      const { layer, degrade } = controlledConnection(open);
      const result = yield* withConnection(layer, (reads) =>
        Effect.gen(function* () {
          const before = yield* reads.SearchItems(everything);
          yield* degrade;
          const exit = yield* eventually(
            Effect.exit(reads.SearchItems(everything)),
            Exit.isFailure,
          );
          const error = yield* Effect.flip(exit);
          return { before, error };
        }),
      );
      expect(result.before).toHaveLength(4);
      expect(result.error).toBeInstanceOf(DbUnavailable);
      expect(result.error.message).toBe("database gone");
    }),
  );

  it.effect(
    "a source that cannot open fails the search with DbUnavailable",
    () =>
      Effect.gen(function* () {
        const { open } = fixtureOpener(() => null);
        const error = yield* withReads(open, (reads) =>
          Effect.flip(reads.SearchItems(everything)),
        );
        expect(error).toBeInstanceOf(DbUnavailable);
      }),
  );

  it.effect("a locale change through Configure rebuilds the held index", () =>
    Effect.gen(function* () {
      const { open, ran } = fixtureOpener();
      const quiet = Layer.effect(Connection)(
        Effect.map(Effect.service(Connection), (base) =>
          Connection.of({ ...base, configure: () => Effect.void }),
        ),
      ).pipe(Layer.provide(layerRcRef(open)));
      const config = (locale: string | null): ReadsConfig => ({
        databasePath: "/Zotero/zotero.sqlite",
        readMode: "auto",
        autoRefresh: true,
        locale,
        chineseSegmenter: null,
        logLevel: null,
      });
      const builds = yield* withConnection(quiet, (reads) =>
        Effect.gen(function* () {
          yield* reads.SearchItems(everything);
          yield* reads.Configure(config("de"));
          return yield* eventually(
            Effect.sync(() => ran(ID_READ)),
            (count) => count >= 4,
          );
        }),
      );
      expect(builds).toBe(4);
    }),
  );

  it.effect(
    "a request sent during a build is answered before the build ends",
    () =>
      Effect.gen(function* () {
        const { open } = fixtureOpener();
        const { layer, holdBorrows, releaseBorrows, borrowHeld } =
          controlledConnection(open);
        const result = yield* withConnection(layer, (reads) =>
          Effect.gen(function* () {
            yield* connect(reads);
            const order: string[] = [];
            yield* holdBorrows;
            const search = yield* Effect.forkChild(
              reads
                .SearchItems(inLibrary(1, "main"))
                .pipe(
                  Effect.tap(() => Effect.sync(() => order.push("search"))),
                ),
            );
            yield* borrowHeld;
            yield* reads.Ping();
            order.push("ping");
            const searching = search.pollUnsafe() === undefined;
            yield* releaseBorrows;
            yield* Fiber.join(search);
            return { order, searching };
          }),
        );
        expect(result.searching).toBe(true);
        expect(result.order).toEqual(["ping", "search"]);
      }),
  );

  describe("with the Chinese Segmenter", () => {
    const CHINESE_TITLE =
      "update itemDataValues set value = '长江流域的城市化研究' where valueID = 3;";
    const JIEBA_ONLY = inLibrary(1, "流域");
    const INSTALLED: SegmenterBinary = {
      url: "app://vault/plugins/zotlit-resources/main.js",
      entry: "chinese-segmenter",
      version: "1.0.0",
    };
    const jiebaBytes = () =>
      readFile(
        fileURLToPath(
          new URL(
            "jieba_rs_wasm_bg.wasm",
            import.meta.resolve("jieba-wasm/web"),
          ),
        ),
      );
    const config = (chineseSegmenter: SegmenterBinary | null): ReadsConfig => ({
      databasePath: "/Zotero/zotero.sqlite",
      readMode: "auto",
      autoRefresh: true,
      locale: null,
      chineseSegmenter,
      logLevel: null,
    });

    const withSegmenter = <A, E>(
      options: Partial<HandlersOptions>,
      body: (
        reads: ZoteroReadsClient,
        ran: (sql: string) => number,
      ) => Effect.Effect<A, E, Scope.Scope>,
    ): Effect.Effect<A, E> => {
      const { open, ran } = fixtureOpener(() => CHINESE_TITLE);
      const quiet = Layer.effect(Connection)(
        Effect.map(Effect.service(Connection), (base) =>
          Connection.of({ ...base, configure: () => Effect.void }),
        ),
      ).pipe(Layer.provide(layerRcRef(open)));
      return Effect.gen(function* () {
        const reads = yield* makeInProcessClient({
          snapshotRevision,
          ...options,
        });
        return yield* body(reads, ran);
      }).pipe(Effect.scoped, Effect.provide([quiet, NodeFileSystem.layer]));
    };

    it.effect(
      "an installed binary at start cuts Chinese titles and queries with jieba",
      () =>
        Effect.gen(function* () {
          const bytes = yield* Effect.promise(() => jiebaBytes());
          const asked: SegmenterBinary[] = [];
          const hits = yield* withSegmenter(
            {
              chineseSegmenter: INSTALLED,
              readSegmenter: (binary) => {
                asked.push(binary);
                return Effect.succeed({ bytes, upstreamVersion: undefined });
              },
            },
            (reads) => reads.SearchItems(JIEBA_ONLY),
          );
          expect(asked).toEqual([INSTALLED]);
          expect(keysOf(hits)).toEqual(["RELA2345"]);
        }),
    );

    it.effect(
      "CheckChineseSegmenter states the Segmenter that the Item Index cuts with",
      () =>
        Effect.gen(function* () {
          const bytes = yield* Effect.promise(() => jiebaBytes());
          let readable = false;
          const result = yield* withSegmenter(
            {
              chineseSegmenter: INSTALLED,
              readSegmenter: () =>
                readable
                  ? Effect.succeed({ bytes, upstreamVersion: undefined })
                  : Effect.fail({
                      kind: "pack-unreadable",
                      detail: "The request for the pack file failed",
                    } as const),
            },
            (reads) =>
              Effect.gen(function* () {
                const refused = {
                  status: yield* reads.CheckChineseSegmenter({
                    binary: INSTALLED,
                  }),
                  hits: keysOf(yield* reads.SearchItems(JIEBA_ONLY)),
                };
                readable = true;
                const status = yield* reads.CheckChineseSegmenter({
                  binary: INSTALLED,
                });
                const hits = yield* eventually(
                  reads.SearchItems(JIEBA_ONLY),
                  (found) => found.length > 0,
                );
                return { refused, ready: { status, hits: keysOf(hits) } };
              }),
          );
          expect(result).toEqual({
            refused: { status: { kind: "pack-damaged" }, hits: [] },
            ready: {
              status: { kind: "ready", version: "1.0.0" },
              hits: ["RELA2345"],
            },
          });
        }),
    );

    it.effect(
      "a Configure that changes the locale and installs the binary rebuilds every held index once",
      () =>
        Effect.gen(function* () {
          const bytes = yield* Effect.promise(() => jiebaBytes());
          const result = yield* withSegmenter(
            {
              readSegmenter: () =>
                Effect.succeed({ bytes, upstreamVersion: undefined }),
            },
            (reads, ran) =>
              Effect.gen(function* () {
                yield* reads.SearchItems(JIEBA_ONLY);
                yield* reads.SearchItems(everything);
                yield* reads.Configure({ ...config(INSTALLED), locale: "zh" });
                for (const list of [
                  JIEBA_ONLY,
                  { ...everything, query: "流域" },
                ]) {
                  yield* eventually(
                    reads.SearchItems(list),
                    (hits) => hits.length > 0,
                  );
                }
                return ran(ID_READ);
              }),
          );
          expect(result).toBe(6);
        }),
    );
  });
});
