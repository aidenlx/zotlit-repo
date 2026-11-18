// The driver conformance suite: what the read engine of @zotlit/db needs from
// a synchronous SQLite driver behind its Drizzle client. An adapter test calls
// `describeDriverConformance` with a factory for its own clients. The file
// loads no Node module, so a test in a Web Worker can run it on SQLite-WASM.
import { eq, sql } from "drizzle-orm";
import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { SQLiteAsyncDatabase } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";

/**
 * The part of the engine's client that the suite calls: a Drizzle SQLite
 * database in the synchronous result mode. `ZoteroDatabase` of `@zotlit/db`
 * gives it.
 */
export type ConformanceClient = Pick<
  SQLiteAsyncDatabase<"sync", unknown, any>,
  "all" | "get" | "run" | "select"
>;

/** A client of the driver under test, with the resources it holds. */
export interface ConformanceConnection extends Disposable {
  readonly db: ConformanceClient;
}

/**
 * Makes the clients of the driver under test. Each database is new and holds
 * the tables and rows that `setup`, a script of SQL statements, makes.
 */
export interface ConformanceDriver {
  /** A writable client on a new database. */
  open(setup: string): ConformanceConnection;
  /** A read-only client on a new database: the way a host reads Zotero's file. */
  openReadOnly(setup: string): ConformanceConnection;
  /**
   * Two clients on one new database file, each with its own connection and no
   * busy timeout. Leave it out for a driver that opens one connection for
   * each file; the busy case then does not run.
   */
  openShared?(setup: string): [ConformanceConnection, ConformanceConnection];
}

const probe = sqliteTable("probe", {
  id: integer().primaryKey(),
  label: text(),
  score: real(),
});

const SETUP = `
  create table probe (id integer primary key, label text, score real);
  insert into probe (id, label, score) values
    (1, 'Écrits', 0.5),
    (2, '論文 📚', null),
    (9007199254740991, null, -2.25);
`;

/**
 * The value a driver threw, through the `cause` chain that Drizzle adds:
 * the SQLite error that names the problem. ZoteroReads reports this message.
 */
function innermost(error: unknown): unknown {
  let current = error;
  while (current instanceof Error && current.cause instanceof Error) {
    current = current.cause;
  }
  return current;
}

function thrownBy(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("the statement ran without an error");
}

/** Register the conformance cases for one driver. */
export function describeDriverConformance(
  name: string,
  driver: ConformanceDriver,
): void {
  describe(`driver conformance: ${name}`, () => {
    it("reads integers, reals, text and null as JavaScript numbers, strings and null", () => {
      using connection = driver.open(SETUP);
      const rows = connection.db.all<Record<string, unknown>>(
        sql`select id, label, score from probe order by id`,
      );
      expect(rows).toEqual([
        { id: 1, label: "Écrits", score: 0.5 },
        { id: 2, label: "論文 📚", score: null },
        { id: Number.MAX_SAFE_INTEGER, label: null, score: -2.25 },
      ]);
      expect(rows.map((row) => typeof row.id)).toEqual([
        "number",
        "number",
        "number",
      ]);
    });

    it("binds number, string and null parameters", () => {
      using connection = driver.open(SETUP);
      const row = connection.db.get<Record<string, unknown>>(
        sql`select ${7} as n, ${"Zotero"} as s, ${null} as z, ${1.5} as r`,
      );
      expect(row).toEqual({ n: 7, s: "Zotero", z: null, r: 1.5 });
    });

    it("runs one prepared statement again with new parameters", () => {
      using connection = driver.open(SETUP);
      const statement = connection.db
        .select({ id: probe.id, label: probe.label })
        .from(probe)
        .where(eq(probe.id, sql.placeholder("id")))
        .prepare();
      expect(statement.all({ id: 1 })).toEqual([{ id: 1, label: "Écrits" }]);
      expect(statement.all({ id: 2 })).toEqual([{ id: 2, label: "論文 📚" }]);
      expect(statement.all({ id: 3 })).toEqual([]);
      expect(statement.all({ id: 1 })).toEqual([{ id: 1, label: "Écrits" }]);
    });

    it("expands a JSON array parameter with json_each, as a keyed read binds its keys", () => {
      using connection = driver.open(SETUP);
      const statement = connection.db
        .select({ id: probe.id })
        .from(probe)
        .where(
          sql`${probe.id} in (select value from json_each(${sql.placeholder("keys")}))`,
        )
        .orderBy(probe.id)
        .prepare();
      expect(statement.all({ keys: JSON.stringify([2, 1, 5]) })).toEqual([
        { id: 1 },
        { id: 2 },
      ]);
    });

    it("builds nested rows with json_object and json_group_array, as a relational query does", () => {
      using connection = driver.open(SETUP);
      const row = connection.db.get<{ rows: string }>(
        sql`select json_group_array(json_object('id', id, 'label', label)) as rows from (select id, label from probe where id < 3 order by id)`,
      );
      expect(JSON.parse(row.rows)).toEqual([
        { id: 1, label: "Écrits" },
        { id: 2, label: "論文 📚" },
      ]);
    });

    it("lists the columns of each table through pragma_table_info, as the layout read does", () => {
      using connection = driver.open(SETUP);
      const rows = connection.db.all<{ tableName: string; columnName: string }>(
        sql`select m.name as tableName, c.name as columnName from sqlite_schema as m join pragma_table_info(m.name) as c where m.type in ('table', 'view') order by m.name, c.cid`,
      );
      expect(rows).toEqual([
        { tableName: "probe", columnName: "id" },
        { tableName: "probe", columnName: "label" },
        { tableName: "probe", columnName: "score" },
      ]);
    });

    it("throws a failed statement in the same call, with the SQLite message as the innermost cause", () => {
      using connection = driver.open(SETUP);
      const error = innermost(
        thrownBy(() => connection.db.all(sql`select * from missing`)),
      );
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("no such table: missing");
    });

    it("refuses a write on a read-only database with the SQLite message as the innermost cause", () => {
      using connection = driver.openReadOnly(SETUP);
      expect(connection.db.all(sql`select id from probe`)).toHaveLength(3);
      const error = innermost(
        thrownBy(() => connection.db.run(sql`delete from probe`)),
      );
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain(
        "attempt to write a readonly database",
      );
    });

    it.skipIf(!driver.openShared)(
      "fails a read while another connection holds an exclusive lock, with the SQLite message as the innermost cause",
      () => {
        const [writer, reader] = driver.openShared!(SETUP);
        using _writer = writer;
        using _reader = reader;
        writer.db.run(sql`begin exclusive`);
        const error = innermost(
          thrownBy(() => reader.db.all(sql`select id from probe`)),
        );
        writer.db.run(sql`rollback`);
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain("database is locked");
        expect(reader.db.all(sql`select id from probe`)).toHaveLength(3);
      },
    );
  });
}
