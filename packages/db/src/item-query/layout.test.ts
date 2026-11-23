import type { NodeDatabaseClient } from "#client/node.ts";
import { Cause, Effect, Exit } from "effect";
import { existsSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { constants } from "node:sqlite";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import type {
  ScenarioDatabase,
  ScenarioDatabaseOptions,
} from "@zotlit/db-testing/scenario";
import {
  openScenarioDatabase,
  SCENARIO_LIBRARIES,
} from "@zotlit/db-testing/scenario";
import { setLibraryLogSink } from "@zotlit/shared/logging";
import type { LibraryLogRecord } from "@zotlit/shared/logging";

import { checkLayout, readerStatementSQL } from "./database.ts";
import {
  ItemQueryDatabase,
  ItemQueryDatabaseError,
  ItemQueryLayoutError,
  readScanPage,
} from "./index.ts";

import { connectClient } from "#client/node.ts";
import { ITEM_QUERY_LAYOUT, OPTIONAL_LAYOUT_COLUMNS } from "#layout/index.ts";

afterEach(() => {
  setLibraryLogSink(undefined);
});

it("releases the scenario connection and directory when the client factory fails", async ({
  annotate,
}) => {
  await annotate("https://github.com/aidenlx/zotlit-repo/issues/71", "issue");
  let connection: DatabaseSync | undefined;
  let directory: string | undefined;
  const failure = new Error("client setup failed");
  try {
    expect(() =>
      openScenarioDatabase(
        (sqlite) => {
          connection = sqlite;
          directory = dirname(sqlite.location()!);
          throw failure;
        },
        { storage: "temp-directory" },
      ),
    ).toThrow(failure);
    expect(connection?.isOpen).toBe(false);
    expect(existsSync(directory!)).toBe(false);
  } finally {
    if (connection?.isOpen) connection.close();
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
});

function openCopy(
  alter: (sqlite: DatabaseSync) => void = () => {},
  options: ScenarioDatabaseOptions = {},
): ScenarioDatabase<NodeDatabaseClient> {
  const copy = openScenarioDatabase(connectClient, options);
  alter(copy.sqlite);
  return copy;
}

function stamp(
  sqlite: DatabaseSync,
  versions: { userdata: number; compatibility: number },
): void {
  const update = sqlite.prepare(
    "update version set version = ? where schema = ?",
  );
  update.run(versions.userdata, "userdata");
  update.run(versions.compatibility, "compatibility");
}

function run<A, E>(
  copy: ScenarioDatabase<NodeDatabaseClient>,
  effect: Effect.Effect<A, E, ItemQueryDatabase>,
) {
  return Effect.runSyncExit(
    Effect.provideService(effect, ItemQueryDatabase, { client: copy.db }),
  );
}

function failureOf<A, E>(exit: Exit.Exit<A, E>): E {
  if (!Exit.isFailure(exit)) throw new Error("the Effect did not fail.");
  const error = Cause.findErrorOption(exit.cause);
  if (error._tag === "None") throw new Error(String(exit.cause));
  return error.value;
}

const firstPage = readScanPage({
  libraryID: SCENARIO_LIBRARIES.personal.libraryID,
  afterItemID: 0,
});

function columnsRead(sqlite: DatabaseSync, sql: string): string[] {
  const tables = new Set(
    (
      sqlite
        .prepare(
          "select name from sqlite_schema where type in ('table', 'view')",
        )
        .all() as { name: string }[]
    ).map((row) => row.name),
  );
  const reads = new Set<string>();
  sqlite.setAuthorizer((action, table, column) => {
    if (action === constants.SQLITE_READ && table && tables.has(table)) {
      reads.add(column ? `${table}.${column}` : table);
    }
    return constants.SQLITE_OK;
  });
  try {
    sqlite.prepare(sql);
  } finally {
    sqlite.setAuthorizer(null);
  }
  return [...reads];
}

describe("ITEM_QUERY_LAYOUT", () => {
  it("lists every table and column that a reader statement reads", () => {
    using scenario = openScenarioDatabase(connectClient);
    const statements = readerStatementSQL(scenario.db);
    const listed = new Set(
      [
        ...Object.entries(ITEM_QUERY_LAYOUT),
        ...Object.entries(OPTIONAL_LAYOUT_COLUMNS),
      ].flatMap(([table, columns]) => [
        table,
        ...columns.map((column) => `${table}.${column}`),
      ]),
    );

    const unlisted = statements.flatMap((sql) =>
      columnsRead(scenario.sqlite, sql)
        .filter((read) => !listed.has(read))
        .map((read) => ({ read, sql })),
    );

    expect(statements.length).toBeGreaterThan(0);
    expect(unlisted).toEqual([]);
  });
});

describe("the layout check", () => {
  it("fails a reader with the layout error when a copy stamped inside the supported range lacks a manifest column", () => {
    using copy = openCopy((sqlite) => {
      stamp(sqlite, { userdata: 129, compatibility: 9 });
      sqlite.exec('alter table "fieldsCombined" drop column "custom"');
    });

    const error = failureOf(run(copy, firstPage));

    expect(error).toBeInstanceOf(ItemQueryLayoutError);
    expect(error).toMatchObject({
      missing: [{ table: "fieldsCombined", column: "custom" }],
      versions: { userdata: 129, compatibility: 9 },
    });
    expect((error as ItemQueryLayoutError).message).toContain(
      "fieldsCombined.custom",
    );
    expect((error as ItemQueryLayoutError).message).toContain("Update ZotLit");
  });

  it("names a missing table once", () => {
    using copy = openCopy((sqlite) => {
      sqlite.exec('drop table "deletedItems"');
    });

    expect(failureOf(run(copy, checkLayout()))).toMatchObject({
      _tag: "ItemQueryLayoutError",
      missing: [{ table: "deletedItems", column: null }],
    });
  });

  it("reads a copy stamped outside the supported range that has the full layout", () => {
    using copy = openCopy((sqlite) => {
      stamp(sqlite, { userdata: 140, compatibility: 12 });
    });

    const exit = run(copy, firstPage);

    expect(Exit.isSuccess(exit) && exit.value.length).toBe(10);
  });

  it("reads the lowest supported layout", () => {
    using copy = openCopy(undefined, { layout: "lowest" });

    const exit = run(copy, firstPage);

    expect(Exit.isSuccess(exit) && exit.value.length).toBe(10);
  });

  it("keeps the check result for the life of the copy", () => {
    using passed = openCopy();
    expect(Exit.isSuccess(run(passed, checkLayout()))).toBe(true);
    passed.sqlite.exec('drop table "deletedItems"');
    expect(failureOf(run(passed, firstPage))).toBeInstanceOf(
      ItemQueryDatabaseError,
    );
    passed.close();

    using failed = openCopy((sqlite) => {
      sqlite.exec('drop table "deletedItems"');
    });
    expect(failureOf(run(failed, checkLayout()))).toBeInstanceOf(
      ItemQueryLayoutError,
    );
    failed.sqlite.exec(
      'create table "deletedItems" (itemID integer primary key)',
    );
    expect(failureOf(run(failed, firstPage))).toBeInstanceOf(
      ItemQueryLayoutError,
    );
  });

  it("logs the userdata and compatibility versions of the copy", () => {
    const records: LibraryLogRecord[] = [];
    setLibraryLogSink((record) => records.push(record));
    using copy = openCopy((sqlite) => {
      stamp(sqlite, { userdata: 140, compatibility: 12 });
    });

    run(copy, firstPage);

    expect(records).toContainEqual(
      expect.objectContaining({
        properties: expect.objectContaining({
          userdata: 140,
          compatibility: 12,
        }),
      }),
    );
  });
});
