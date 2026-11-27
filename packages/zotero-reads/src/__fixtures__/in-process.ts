import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { Effect, Layer, Stream } from "effect";
import type { Scope } from "effect";

import { createFixtureSchema } from "@zotlit/db-testing";
import { createClient } from "@zotlit/db/client/node";
import type { NodeDatabaseClient } from "@zotlit/db/client/node";

import { nodeClient } from "#desktop/node-client.ts";
import { snapshotRevision } from "#desktop/snapshot-revision.ts";
import { testReads } from "./reads.ts";
import type { TestReads } from "./reads.ts";
import { layerRcRef } from "#worker/connection.ts";
import type { Connection, ConnectionOpener } from "#worker/connection.ts";
import type { HandlersOptions } from "#worker/handlers.ts";
import { makeInProcessClient } from "#worker/in-process.ts";
import type { FileReadsConfig, ZoteroReadsClient } from "#contract/rpc.ts";
import type { SnapshotId } from "#contract/rpc.ts";

export const inProcessClient = Effect.fnUntraced(function* (
  connection: Layer.Layer<Connection>,
  options?: Partial<HandlersOptions>,
  config?: FileReadsConfig,
): Effect.fn.Return<ZoteroReadsClient, never, Scope.Scope> {
  const services = yield* Layer.build(
    Layer.merge(connection, NodeFileSystem.layer),
  );
  const client = yield* Effect.provideContext(
    makeInProcessClient({ snapshotRevision, ...options }),
    services,
  );
  if (config) yield* Effect.orDie(client.Configure(config));
  return client;
});

export function fileConfig(
  databasePath: string,
  sourceId: string | null,
): FileReadsConfig {
  return {
    databasePath,
    sourceId,
    readMode: "auto",
    autoRefresh: false,
    locale: null,
    chineseSegmenter: null,
    logLevel: null,
  };
}

export function memoryOpener(seed: (open: number) => string | null) {
  const log: string[] = [];
  let opened = 0;
  const open: ConnectionOpener = () => {
    const id = ++opened;
    const sql = seed(id);
    if (sql === null) throw new Error(`source #${id} is not readable`);
    const client: NodeDatabaseClient = createClient(":memory:");
    const sqlite = client.$client;
    createFixtureSchema(sqlite);
    sqlite.exec(sql);
    const close = sqlite.close.bind(sqlite);
    sqlite.close = () => {
      log.push(`close #${id}`);
      close();
    };
    log.push(`open #${id}`);
    return nodeClient(client);
  };
  return { open, log };
}

export function sharedClientOpener(
  client: NodeDatabaseClient,
): ConnectionOpener {
  const shared = Object.create(client, {
    $client: { value: { close() {} } },
  }) as NodeDatabaseClient;
  return () => nodeClient(shared);
}

export interface InProcessReadsOptions {
  wrap?: (client: ZoteroReadsClient) => ZoteroReadsClient;
  opening?: Promise<void>;
  handlers?: Partial<HandlersOptions>;
  config?: FileReadsConfig;
}

export function inProcessReadsService(
  opener: ConnectionOpener,
  {
    wrap = (client) => client,
    opening = Promise.resolve(),
    handlers,
    config,
  }: InProcessReadsOptions = {},
): TestReads {
  return testReads(
    Effect.andThen(
      Effect.promise(() => opening),
      Effect.map(
        inProcessClient(layerRcRef(opener), handlers, config),
        (client) => wrap(client),
      ),
    ),
  );
}

export function stubbedReads(): Pick<
  TestReads,
  "reads" | "ready" | "acquireRead"
> &
  AsyncDisposable & {
    state: import("#client/service.ts").ZoteroReadsState["state"];
  } {
  const service = inProcessReadsService(memoryOpener(() => "").open);
  return {
    state: "ready",
    reads: service.reads,
    get ready() {
      return service.ready;
    },
    acquireRead: () => service.acquireRead(),
    [Symbol.asyncDispose]: () => service[Symbol.asyncDispose](),
  };
}

export function withState<S extends TestReads>(
  service: S,
  state: import("#client/service.ts").ZoteroReadsState["state"],
): S {
  return Object.assign(service, {
    current: Effect.map(service.current, (current) => ({ ...current, state })),
  });
}

export interface RecordedCall {
  readonly operation: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export function recordCalls(operations: readonly (keyof ZoteroReadsClient)[]): {
  wrap: (client: ZoteroReadsClient) => ZoteroReadsClient;
  calls: RecordedCall[];
  snapshots: SnapshotId[];
} {
  const calls: RecordedCall[] = [];
  const snapshots: SnapshotId[] = [];
  const wrap = (client: ZoteroReadsClient): ZoteroReadsClient => {
    const wrapped: Record<string, unknown> = {
      ...client,
      Snapshot: (payload?: object, options?: object) =>
        (
          client.Snapshot as (
            payload?: object,
            options?: object,
          ) => Stream.Stream<SnapshotId, unknown>
        )(payload, options).pipe(
          Stream.tap((id) => Effect.sync(() => snapshots.push(id))),
        ),
    };
    for (const operation of operations) {
      const call = client[operation] as (
        payload: object,
        options?: object,
      ) => unknown;
      wrapped[operation] = (payload: object, options?: object) => {
        calls.push({
          operation,
          payload: payload as Record<string, unknown>,
        });
        return call(payload, options);
      };
    }
    return wrapped as unknown as ZoteroReadsClient;
  };
  return { wrap, calls, snapshots };
}

export interface SeededWork {
  readonly itemID: number;
  readonly key: string;
  readonly libraryID?: number;
  readonly itemType?: (typeof SEEDED_ITEM_TYPES)[number];
  readonly title?: string;
  readonly citationKey?: string;
  readonly date?: string;
  readonly creators?: readonly (readonly [string, string])[];
}

export interface SeededAttachment {
  readonly itemID: number;
  readonly key: string;
  readonly parentItemID: number;
  readonly path: string | null;
  readonly linkMode: number;
}

const SEEDED_ITEM_TYPES = ["journalArticle", "letter", "book"] as const;
export const ATTACHMENT_TYPE_ID = 99;
const SEEDED_FIELD_IDS = { title: 10, citationKey: 11, date: 12 } as const;

const quoteSql = (value: string) => `'${value.replaceAll("'", "''")}'`;

export function seedWorksSql(
  works: readonly SeededWork[],
  attachments: readonly SeededAttachment[] = [],
): string {
  const types = SEEDED_ITEM_TYPES.map(
    (name, index) => `(${index + 1}, '${name}')`,
  ).join(", ");
  const primaries = SEEDED_ITEM_TYPES.map(
    (_, index) => `(${index + 1}, 1, 1)`,
  ).join(", ");
  return [
    "insert into libraries (libraryID, type) values (1, 'user');",
    `insert into itemTypes (itemTypeID, typeName) values ${types}, (${ATTACHMENT_TYPE_ID}, 'attachment');`,
    "insert into fieldsCombined (fieldID, fieldName, custom) values (10, 'title', 0), (11, 'citationKey', 0), (12, 'date', 0);",
    "insert into creatorTypes (creatorTypeID, creatorType) values (1, 'author');",
    `insert into itemTypeCreatorTypes (itemTypeID, creatorTypeID, primaryField) values ${primaries};`,
    worksSql(works, attachments),
  ].join("\n");
}

export function worksSql(
  works: readonly SeededWork[],
  attachments: readonly SeededAttachment[] = [],
): string {
  const stamp = "'2024-01-01 00:00:00'";
  const sql: string[] = [];
  for (const work of works) {
    const typeID =
      SEEDED_ITEM_TYPES.indexOf(work.itemType ?? "journalArticle") + 1;
    sql.push(
      `insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key) values (${work.itemID}, ${typeID}, ${stamp}, ${stamp}, ${work.libraryID ?? 1}, ${quoteSql(work.key)});`,
    );
    for (const field of ["title", "citationKey", "date"] as const) {
      const value = work[field];
      if (value === undefined) continue;
      const valueID = work.itemID * 10 + SEEDED_FIELD_IDS[field] - 10;
      sql.push(
        `insert into itemDataValues (valueID, value) values (${valueID}, ${quoteSql(value)});`,
        `insert into itemData (itemID, fieldID, valueID) values (${work.itemID}, ${SEEDED_FIELD_IDS[field]}, ${valueID});`,
      );
    }
    for (const [index, [firstName, lastName]] of (
      work.creators ?? []
    ).entries()) {
      const creatorID = work.itemID * 10 + index;
      sql.push(
        `insert into creators (creatorID, firstName, lastName, fieldMode) values (${creatorID}, ${quoteSql(firstName)}, ${quoteSql(lastName)}, 0);`,
        `insert into itemCreators (itemID, creatorID, creatorTypeID, orderIndex) values (${work.itemID}, ${creatorID}, 1, ${index});`,
      );
    }
  }
  for (const attachment of attachments) {
    sql.push(
      `insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key) values (${attachment.itemID}, ${ATTACHMENT_TYPE_ID}, ${stamp}, ${stamp}, 1, ${quoteSql(attachment.key)});`,
      `insert into itemAttachments (itemID, parentItemID, linkMode, path) values (${attachment.itemID}, ${attachment.parentItemID}, ${attachment.linkMode}, ${attachment.path === null ? "null" : quoteSql(attachment.path)});`,
    );
  }
  return sql.join("\n");
}

export const CLEAR_WORKS_SQL = `
  delete from itemAttachments;
  delete from itemCreators;
  delete from creators;
  delete from itemData;
  delete from itemDataValues;
  delete from items;
`;

export function citedWorkSeed(keys: readonly string[]): string {
  const items = keys
    .map(
      (key, i) =>
        `(${i + 1}, 1, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, '${key}')`,
    )
    .join(", ");
  const data = keys
    .map((_, i) => `(${i + 1}, 10, 1), (${i + 1}, 12, 2)`)
    .join(", ");
  const creators = keys.map((_, i) => `(${i + 1}, 1, 1, 0)`).join(", ");
  return `
    insert into libraries (libraryID, type, version, clientVersion)
      values (1, 'user', 1, 1);
    insert into settings (setting, key, value) values ('account', 'userID', 1);
    insert into itemTypes (itemTypeID, typeName) values (1, 'journalArticle');
    insert into fieldsCombined (fieldID, fieldName, custom)
      values (10, 'title', 0), (12, 'date', 0);
    insert into itemDataValues (valueID, value)
      values (1, 'A study of nothing'), (2, '2020');
    insert into creators (creatorID, firstName, lastName, fieldMode)
      values (1, 'Ann', 'Zeta', 0);
    insert into creatorTypes (creatorTypeID, creatorType) values (1, 'author');
    insert into itemTypeCreatorTypes (itemTypeID, creatorTypeID, primaryField)
      values (1, 1, 1);
    insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key)
      values ${items};
    insert into itemData (itemID, fieldID, valueID) values ${data};
    insert into itemCreators (itemID, creatorID, creatorTypeID, orderIndex)
      values ${creators};
  `;
}
