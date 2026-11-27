import { it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import type { DatabaseSync } from "node:sqlite";
import { describe, expect } from "vitest";

import { getLibraries, getSchemaVersions } from "@zotlit/db";
import { countStatements, createFixtureSchema } from "@zotlit/db-testing";
import { openScenarioDatabase } from "@zotlit/db-testing/scenario";
import type { ScenarioDatabaseOptions } from "@zotlit/db-testing/scenario";
import { createClient, connectClient } from "@zotlit/db/client/node";
import { ItemQueryDatabase, readLibraries } from "@zotlit/db/item-query";
import { collectQuery, ITEMS } from "@zotlit/item-query";

import { validateClient, webApiSourceIdentity } from "./connection.ts";

import { SourceIdentitySchema } from "#contract/source-identity.ts";
import { nodeClient } from "#desktop/node-client.ts";

interface Copy {
  readonly name: string;
  readonly options?: ScenarioDatabaseOptions;
  readonly alter?: (sqlite: DatabaseSync) => void;
  readonly ddl?: string;
}

function stampUserdata(version: number) {
  return (sqlite: DatabaseSync) => {
    sqlite
      .prepare("update version set version = ? where schema = 'userdata'")
      .run(version);
  };
}

const READABLE: readonly Copy[] = [
  { name: "the Zotero 10 layout" },
  { name: "the lowest layout", options: { layout: "lowest" } },
  {
    name: "the lowest layout stamped outside the supported range",
    options: { layout: "lowest" },
    alter: stampUserdata(999),
  },
  {
    name: "a Zotero 10 copy without libraries.clientVersion",
    alter: (sqlite) => {
      sqlite.exec('alter table "libraries" drop column "clientVersion"');
    },
  },
  {
    name: "the Zotero 10 layout stamped outside the supported range",
    alter: stampUserdata(140),
  },
];

const UNREADABLE: readonly Copy[] = [
  {
    name: "a copy without fieldsCombined.custom",
    alter: (sqlite) => {
      sqlite.exec('alter table "fieldsCombined" drop column "custom"');
    },
  },
  {
    name: "the lowest layout without the deletedItems table",
    options: { layout: "lowest" },
    alter: (sqlite) => {
      sqlite.exec('drop table "deletedItems"');
    },
  },
];

const NOT_ZOTERO: readonly Copy[] = [
  { name: "an empty database", ddl: "" },
  { name: "a database with only a foo table", ddl: "create table foo (id)" },
];

function open({ options, alter, ddl }: Copy) {
  if (ddl !== undefined) {
    const db = createClient(":memory:");
    db.$client.exec(ddl);
    const close = () => {
      if (db.$client.isOpen) db.$client.close();
    };
    return { db, sqlite: db.$client, [Symbol.dispose]: close };
  }
  const copy = openScenarioDatabase(connectClient, options);
  alter?.(copy.sqlite);
  return copy;
}

const zoteroReadsValidates = Effect.fnUntraced(function* (copy: Copy) {
  using scenario = open(copy);
  return yield* Effect.isSuccess(validateClient(nodeClient(scenario.db)));
});

const itemQueryReads = Effect.fnUntraced(function* (copy: Copy) {
  using scenario = open(copy);
  return yield* Effect.isSuccess(
    Effect.provideService(
      Effect.gen(function* () {
        const libraries = yield* readLibraries();
        return yield* collectQuery(ITEMS, {
          libraries: libraries.map(({ libraryID, groupID }) => ({
            libraryID,
            groupID,
          })),
          fields: ["title"],
          limit: 1,
        });
      }),
      ItemQueryDatabase,
      { client: scenario.db },
    ),
  );
});

describe("validateClient and Item Query", () => {
  it.effect.each(READABLE)("both read $name", (copy) =>
    Effect.gen(function* () {
      expect(yield* zoteroReadsValidates(copy)).toBe(true);
      expect(yield* itemQueryReads(copy)).toBe(true);
    }),
  );

  it.effect.each(UNREADABLE)("both refuse $name", (copy) =>
    Effect.gen(function* () {
      expect(yield* zoteroReadsValidates(copy)).toBe(false);
      expect(yield* itemQueryReads(copy)).toBe(false);
    }),
  );

  it.effect.each(NOT_ZOTERO)("both refuse $name", (copy) =>
    Effect.gen(function* () {
      expect(yield* zoteroReadsValidates(copy)).toBe(false);
      expect(yield* itemQueryReads(copy)).toBe(false);
    }),
  );

  it.effect.each(NOT_ZOTERO)("refuses $name as not a Zotero database", (copy) =>
    Effect.gen(function* () {
      using plain = open(copy);

      expect(
        (yield* Effect.flip(validateClient(nodeClient(plain.db)))).message,
      ).toBe(
        "This file is not a Zotero database. Check the Zotero data directory in ZotLit settings.",
      );
    }),
  );

  it.effect(
    "refuses a copy the readers cannot read with the layout error",
    () =>
      Effect.gen(function* () {
        using scenario = open(UNREADABLE[0]!);

        expect(
          yield* Effect.flip(validateClient(nodeClient(scenario.db))),
        ).toMatchObject({
          _tag: "ItemQueryLayoutError",
          missing: [{ table: "fieldsCombined", column: "custom" }],
        });
      }),
  );

  it.effect(
    "reads the layout of a copy once for validation, the stamps, and the Library readers",
    () =>
      Effect.gen(function* () {
        using scenario = openScenarioDatabase(connectClient);
        const statements = countStatements(scenario.sqlite);

        yield* validateClient(nodeClient(scenario.db));
        const validated = statements();
        getSchemaVersions(scenario.db);
        getLibraries(scenario.db);
        yield* Effect.provideService(readLibraries(), ItemQueryDatabase, {
          client: scenario.db,
        });

        expect(validated).toBe(2);
        expect(statements()).toBe(validated + 2);
      }),
  );
});

describe("the source identity of the Web API source", () => {
  it.effect("names a replica with no account rows web-api:unsynced", () =>
    Effect.gen(function* () {
      const client = createClient(":memory:");
      createFixtureSchema(client.$client);
      const identity = yield* webApiSourceIdentity(nodeClient(client).client);
      client.$client.close();
      expect(identity).toEqual({
        kind: "web-api",
        id: "web-api:unsynced",
        userID: null,
        username: null,
      });
      expect(
        yield* Schema.decodeEffect(SourceIdentitySchema)(identity),
      ).toEqual(identity);
    }),
  );

  it("refuses an id that its account does not give", () => {
    expect(() =>
      Schema.decodeSync(SourceIdentitySchema)({
        kind: "web-api",
        id: "web-api:marker",
        userID: 1,
        username: "marker",
      }),
    ).toThrow("web-api:1");
  });
});
