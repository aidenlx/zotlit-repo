import { eq, sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

import { describeDriverConformance } from "@zotlit/db-testing/conformance";

import { loadSqliteWasm, SqliteError, StorageError } from "./index.ts";
import type { SqliteWasmDatabase } from "./index.ts";

const require = createRequire(import.meta.url);
const wasm = readFileSync(
  require.resolve("@sqlite.org/sqlite-wasm/sqlite3.wasm"),
);
const sqlite = await loadSqliteWasm({ wasm, storage: "memory" });

let files = 0;
const nextFile = () => `/conformance-${++files}.sqlite`;

function connection(database: SqliteWasmDatabase<any>) {
  return { db: database.db, [Symbol.dispose]: () => database.close() };
}

describeDriverConformance("sqlite-wasm on memory storage", {
  open: (setup) => {
    const database = sqlite.open({ file: nextFile() });
    database.exec(setup);
    return connection(database);
  },
  openReadOnly: (setup) => {
    const file = nextFile();
    using writer = sqlite.open({ file });
    writer.exec(setup);
    writer.close();
    return connection(sqlite.open({ file, readOnly: true }));
  },
  openShared: (setup) => {
    const file = nextFile();
    const writer = sqlite.open({ file });
    writer.exec(setup);
    return [connection(writer), connection(sqlite.open({ file }))];
  },
});

const note = sqliteTable("note", { id: integer().primaryKey(), body: text() });

function openNotes(rows: string[] = ["first", "second"]) {
  const database = sqlite.open({ file: nextFile() });
  database.exec("create table note (id integer primary key, body text)");
  for (const body of rows) {
    database.db.insert(note).values({ body }).run();
  }
  database.renew();
  return database;
}

function thrown(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("the call ran without an error");
}

function consoleLines() {
  const spies = (["debug", "log", "info", "warn", "error"] as const).map(
    (level) => [level, vi.spyOn(console, level)] as const,
  );
  return {
    calls: () =>
      spies.flatMap(([level, spy]) =>
        spy.mock.calls.map((args) => `${level}: ${args.map(String).join(" ")}`),
      ),
    restore: () => {
      for (const [, spy] of spies) spy.mockRestore();
    },
  };
}

function openStatements(database: SqliteWasmDatabase<any>): number {
  const row = database.db.get<{ n: number }>(
    sql`select count(*) as n from sqlite_stmt where sql not like '%sqlite_stmt%'`,
  );
  return row!.n;
}

describe("loading the wasm", () => {
  it("instantiates the module from the bytes that the caller gives", async () => {
    const loaded = await loadSqliteWasm({ wasm, storage: "memory" });
    using database = loaded.open({ file: "/bytes.sqlite" });
    expect(database.db.get(sql`select sqlite_version() as v`)).toEqual({
      v: "3.54.1",
    });
    loaded.close();
  });

  it("accepts a compiled WebAssembly module", async () => {
    const loaded = await loadSqliteWasm({
      wasm: await WebAssembly.compile(wasm),
      storage: "memory",
    });
    expect(loaded.version).toMatch(/^3\.54\./);
    loaded.close();
  });

  it.each(["memory", "opfs-sahpool"] as const)(
    "loads on %s storage with no line on the console",
    async (storage) => {
      const lines = consoleLines();
      try {
        await loadSqliteWasm({ wasm, storage }).then(
          (loaded) => loaded.close(),
          () => undefined,
        );
        expect(lines.calls()).toEqual([]);
      } finally {
        lines.restore();
      }
    },
  );

  it("loads three times at once with no line on the console from any load", async () => {
    const lines = consoleLines();
    try {
      const loaded = await Promise.all([
        loadSqliteWasm({ wasm, storage: "memory" }),
        loadSqliteWasm({
          wasm: await WebAssembly.compile(wasm),
          storage: "memory",
        }),
        loadSqliteWasm({ wasm, storage: "memory" }),
      ]);
      for (const engine of loaded) engine.close();
      expect(lines.calls()).toEqual([]);
      expect("sqlite3ApiConfig" in globalThis).toBe(false);
    } finally {
      lines.restore();
    }
  });

  it("frees the engine of the last load after its close", async () => {
    setFlagsFromString("--expose-gc");
    const collect = runInNewContext("gc") as () => void;
    const original = WebAssembly.instantiate;
    let engine: WeakRef<WebAssembly.Instance> | undefined;
    WebAssembly.instantiate = ((...args: Parameters<typeof original>) => {
      const made = original(...args) as Promise<unknown>;
      void made.then((value) => {
        const instance =
          value instanceof WebAssembly.Instance
            ? value
            : (value as WebAssembly.WebAssemblyInstantiatedSource).instance;
        engine = new WeakRef(instance);
      });
      return made;
    }) as typeof original;
    try {
      (await loadSqliteWasm({ wasm, storage: "memory" })).close();
    } finally {
      WebAssembly.instantiate = original;
    }
    for (let round = 0; round < 10 && engine?.deref(); round++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      collect();
    }
    expect(engine).toBeDefined();
    expect(engine!.deref()).toBeUndefined();
  });

  it("does not try the opfs VFSes in a worker that has SharedArrayBuffer and the OPFS APIs", async () => {
    const lines = consoleLines();
    const workers: string[] = [];
    vi.stubGlobal("location", new URL("blob:app://obsidian.md/worker"));
    vi.stubGlobal("WorkerGlobalScope", class {});
    vi.stubGlobal("FileSystemHandle", class {});
    vi.stubGlobal("FileSystemDirectoryHandle", class {});
    vi.stubGlobal(
      "FileSystemFileHandle",
      class {
        createSyncAccessHandle() {}
      },
    );
    vi.stubGlobal("navigator", { storage: { getDirectory: async () => ({}) } });
    vi.stubGlobal(
      "Worker",
      class {
        constructor(url: string) {
          workers.push(url);
          throw new Error("no worker script at this URL");
        }
      },
    );
    try {
      const loaded = await loadSqliteWasm({ wasm, storage: "memory" });
      loaded.close();
      expect(workers).toEqual([]);
      expect(lines.calls()).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
      lines.restore();
    }
  });

  it("rejects bytes that are not the sqlite wasm, and does not wait forever", async () => {
    await expect(
      loadSqliteWasm({ wasm: new Uint8Array([0, 1, 2, 3]), storage: "memory" }),
    ).rejects.toBeInstanceOf(WebAssembly.CompileError);
  });
});

describe("storage", () => {
  it("gives a typed error when opfs-sahpool cannot open, and no database", async () => {
    const failure = await loadSqliteWasm({
      wasm,
      storage: "opfs-sahpool",
      directory: ".conformance-pool",
    }).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(StorageError);
    expect(failure).toMatchObject({
      storage: "opfs-sahpool",
      reason: "unavailable",
    });
    expect((failure as Error).message).toContain("Missing required OPFS APIs");
  });

  it("refuses a read-only open of a file that does not exist, with the SQLite result code", () => {
    const error = (() => {
      try {
        sqlite.open({ file: "/absent.sqlite", readOnly: true });
      } catch (caught) {
        return caught;
      }
    })();
    expect(error).toBeInstanceOf(SqliteError);
    expect((error as SqliteError).code).toBe("SQLITE_CANTOPEN");
    expect((error as SqliteError).resultCode).toBe(14);
  });

  it("gives a failed statement as a SqliteError with its result code", () => {
    using database = openNotes();
    const error = (() => {
      try {
        database.db.insert(note).values({ id: 1, body: "again" }).run();
      } catch (caught) {
        return caught;
      }
    })() as Error;
    expect(error.cause).toBeInstanceOf(SqliteError);
    expect((error.cause as SqliteError).code).toBe(
      "SQLITE_CONSTRAINT_PRIMARYKEY",
    );
    expect((error.cause as SqliteError).message).toContain(
      "UNIQUE constraint failed: note.id",
    );
  });
});

describe("import and export", () => {
  it("opens a relative file name as its absolute name, as the pool of opfs-sahpool names it", () => {
    using writer = sqlite.open({ file: "relative.sqlite" });
    expect(writer.file).toBe("/relative.sqlite");
    writer.exec("create table t (x); insert into t values (1)");
    using reader = sqlite.open({ file: "/relative.sqlite", readOnly: true });
    expect(reader.db.all(sql`select x from t`)).toEqual([{ x: 1 }]);
    using target = sqlite.open({ file: "imported.sqlite" });
    target.import(writer.export());
    expect(target.db.all(sql`select x from t`)).toEqual([{ x: 1 }]);
  });

  it("keeps the content of a database file", () => {
    using source = openNotes(["Écrits", "論文 📚"]);
    const bytes = source.export();
    using target = sqlite.open({ file: nextFile() });
    target.import(bytes);
    expect(target.db.select().from(note).orderBy(note.id).all()).toEqual([
      { id: 1, body: "Écrits" },
      { id: 2, body: "論文 📚" },
    ]);
    expect(target.export()).toEqual(bytes);
  });

  it("reads the new content through a statement prepared before the import", () => {
    using target = openNotes(["old"]);
    const statement = target.db
      .select({ body: note.body })
      .from(note)
      .where(eq(note.id, sql.placeholder("id")))
      .prepare();
    expect(statement.get({ id: 1 })).toEqual({ body: "old" });
    using source = openNotes(["new"]);
    target.import(source.export());
    expect(statement.get({ id: 1 })).toEqual({ body: "new" });
  });

  it("refuses an import into a read-only database and keeps its file", () => {
    using source = openNotes(["replacement"]);
    const file = nextFile();
    using writer = sqlite.open({ file });
    writer.exec("create table note (id integer primary key, body text)");
    writer.db.insert(note).values({ body: "original" }).run();
    writer.close();
    using reader = sqlite.open({ file, readOnly: true });
    const error = thrown(() => reader.import(source.export()));
    expect(error).toBeInstanceOf(SqliteError);
    expect((error as SqliteError).code).toBe("SQLITE_READONLY");
    expect(reader.db.select({ body: note.body }).from(note).all()).toEqual([
      { body: "original" },
    ]);
  });

  it("refuses bytes that are not a database and keeps the open database", () => {
    using database = openNotes(["kept"]);
    const error = (() => {
      try {
        database.import(new TextEncoder().encode("not a database"));
      } catch (caught) {
        return caught;
      }
    })();
    expect(error).toBeInstanceOf(SqliteError);
    expect((error as SqliteError).code).toBe("SQLITE_NOTADB");
    expect(database.db.select({ body: note.body }).from(note).all()).toEqual([
      { body: "kept" },
    ]);
  });

  it("opens an imported database that was in WAL mode", () => {
    using source = openNotes(["wal"]);
    const bytes = source.export();
    bytes[18] = 2;
    bytes[19] = 2;
    using target = sqlite.open({ file: nextFile() });
    target.import(bytes);
    expect(target.db.select({ body: note.body }).from(note).all()).toEqual([
      { body: "wal" },
    ]);
  });
});

describe("removing a file", () => {
  it("deletes a closed database file, so the next open makes an empty one", () => {
    const file = nextFile();
    const database = openNotes(["kept"]);
    const named = sqlite.open({ file });
    named.import(database.export());
    database.close();
    named.close();
    expect(sqlite.remove(file)).toBe(true);
    using reopened = sqlite.open({ file });
    expect(reopened.db.all(sql`select name from sqlite_master`)).toEqual([]);
  });

  it("answers false for a file that does not exist", () => {
    expect(sqlite.remove(nextFile())).toBe(false);
  });

  it("refuses to remove an open file and keeps its content", () => {
    using database = openNotes(["kept"]);
    const error = thrown(() => sqlite.remove(database.file));
    expect(error).toBeInstanceOf(SqliteError);
    expect(error).toMatchObject({ code: "SQLITE_MISUSE" });
    expect(database.db.select({ body: note.body }).from(note).all()).toEqual([
      { body: "kept" },
    ]);
  });
});

describe("transactions", () => {
  it("commits, and rolls back when the callback throws", () => {
    using database = openNotes([]);
    database.db.transaction((tx) => {
      tx.insert(note).values({ body: "kept" }).run();
    });
    expect(() =>
      database.db.transaction((tx) => {
        tx.insert(note).values({ body: "dropped" }).run();
        throw new Error("stop");
      }),
    ).toThrow("stop");
    expect(database.db.select({ body: note.body }).from(note).all()).toEqual([
      { body: "kept" },
    ]);
  });

  it("rolls back a nested transaction to its savepoint and keeps the outer one", () => {
    using database = openNotes([]);
    database.db.transaction((tx) => {
      tx.insert(note).values({ body: "outer" }).run();
      expect(() =>
        tx.transaction((nested) => {
          nested.insert(note).values({ body: "inner" }).run();
          nested.rollback();
        }),
      ).toThrow();
      tx.transaction((nested) => {
        nested.insert(note).values({ body: "second inner" }).run();
      });
    });
    expect(
      database.db.select({ body: note.body }).from(note).orderBy(note.id).all(),
    ).toEqual([{ body: "outer" }, { body: "second inner" }]);
  });

  it.each(["deferred", "immediate", "exclusive"] as const)(
    "commits a transaction that begins %s",
    (behavior) => {
      using database = openNotes([]);
      database.db.transaction(
        (tx) => {
          tx.insert(note).values({ body: behavior }).run();
        },
        { behavior },
      );
      expect(database.db.select({ body: note.body }).from(note).all()).toEqual([
        { body: behavior },
      ]);
    },
  );

  it("refuses a concurrent transaction", () => {
    using database = openNotes([]);
    expect(() =>
      database.db.transaction(() => {}, { behavior: "concurrent" }),
    ).toThrow("Concurrent transactions are not supported");
  });
});

describe("statements", () => {
  it("keeps one statement for each recent text of a query that is not prepared, and at most 64", () => {
    using database = openNotes();
    for (let index = 0; index < 50; index++) {
      expect(database.db.select().from(note).all()).toHaveLength(2);
    }
    expect(openStatements(database)).toBe(1);
    for (let index = 0; index < 100; index++) {
      database.db.all(sql.raw(`select ${index} as n`));
    }
    expect(openStatements(database)).toBe(64);
  });

  it("frees the kept statements of queries that are not prepared when the database renews or closes", () => {
    const database = openNotes();
    database.db.select().from(note).all();
    database.renew();
    expect(openStatements(database)).toBe(0);
    database.db.select().from(note).all();
    database.close();
    expect(() => database.db.select().from(note).all()).toThrow();
  });

  it("reads the columns of a reused statement after a schema change", () => {
    using database = openNotes(["kept"]);
    const all = () => database.db.all(sql`select * from note`);
    expect(all()).toEqual([{ id: 1, body: "kept" }]);
    database.exec("alter table note add column extra text default 'new'");
    expect(all()).toEqual([{ id: 1, body: "kept", extra: "new" }]);
  });

  it("reads a reused statement with new parameters and after a failed run", () => {
    using database = openNotes();
    const body = (id: number) =>
      database.db
        .select({ body: note.body })
        .from(note)
        .where(eq(note.id, id))
        .get();
    expect(body(1)).toEqual({ body: "first" });
    expect(body(2)).toEqual({ body: "second" });
    expect(() =>
      database.db.insert(note).values({ id: 1, body: "again" }).run(),
    ).toThrow();
    expect(
      database.db.insert(note).values({ id: 3, body: "third" }).run(),
    ).toMatchObject({ changes: 1 });
    expect(body(3)).toEqual({ body: "third" });
  });

  it("keeps one statement for a prepared query", () => {
    using database = openNotes();
    const statement = database.db
      .select({ id: note.id })
      .from(note)
      .where(eq(note.id, sql.placeholder("id")))
      .prepare();
    for (let index = 0; index < 50; index++) statement.all({ id: 1 });
    expect(openStatements(database)).toBe(1);
  });

  it("runs a prepared statement again after it failed", () => {
    using database = openNotes();
    const statement = database.db
      .select({ value: sql<string>`json(${sql.placeholder("text")})` })
      .from(note)
      .where(eq(note.id, 1))
      .prepare();
    expect(() => statement.get({ text: "{bad" })).toThrow();
    expect(statement.get({ text: '{"a":1}' })).toEqual({ value: '{"a":1}' });
  });

  it("gives the changed row count and the last row ID of a write", () => {
    using database = openNotes();
    expect(database.db.insert(note).values({ body: "third" }).run()).toEqual({
      changes: 1,
      lastInsertRowid: 3,
    });
  });

  it("reads a blob as bytes", () => {
    using database = openNotes();
    const row = database.db.get<{ b: Uint8Array }>(sql`select x'00ff' as b`);
    expect([...row!.b]).toEqual([0, 255]);
  });
});

describe("the transaction state", () => {
  it("tells whether a transaction is open, also after SQLite ended one on its own", () => {
    using database = openNotes();
    expect(database.inTransaction()).toBe(false);
    database.exec("begin immediate");
    expect(database.inTransaction()).toBe(true);
    database.exec("commit");
    expect(database.inTransaction()).toBe(false);
    database.exec("pragma max_page_count = 2; begin immediate");
    const error = thrown(() =>
      database.exec(`insert into note (body) values ('${"x".repeat(9000)}')`),
    );
    expect((error as SqliteError).code).toBe("SQLITE_FULL");
    expect(database.inTransaction()).toBe(false);
  });
});

describe("two connections to one file", () => {
  function openPair() {
    const file = nextFile();
    const writer = sqlite.open({ file });
    writer.exec("create table note (id integer primary key, body text)");
    writer.db.insert(note).values({ body: "committed" }).run();
    const reader = sqlite.open({ file });
    return { writer, reader };
  }
  const bodies = (database: SqliteWasmDatabase<any>) =>
    database.db
      .select({ body: note.body })
      .from(note)
      .all()
      .map((row) => row.body);

  it("reads the committed rows while the other connection writes a transaction, and the new rows after its commit", () => {
    const { writer, reader } = openPair();
    using _writer = writer;
    using _reader = reader;
    writer.exec("pragma cache_spill = off; begin immediate");
    writer.db.insert(note).values({ body: "pending" }).run();
    expect(bodies(reader)).toEqual(["committed"]);
    writer.exec("commit");
    expect(bodies(reader)).toEqual(["committed", "pending"]);
  });

  it("gives the page cache use and the spills of a connection, and a spill keeps the reader out until the commit", () => {
    const { writer, reader } = openPair();
    using _writer = writer;
    using _reader = reader;
    writer.exec("pragma cache_size = -1048576; begin immediate");
    const insert = () => {
      for (let index = 0; index < 200; index++) {
        writer.db
          .insert(note)
          .values({ body: "x".repeat(500) })
          .run();
      }
    };
    insert();
    const held = writer.cacheStatus();
    expect(held.spills).toBe(0);
    expect(held.used).toBeGreaterThan(20 * 4096);
    expect(bodies(reader)).toEqual(["committed"]);
    writer.exec("pragma cache_size = 10");
    insert();
    expect(writer.cacheStatus().spills).toBeGreaterThan(0);
    const error = thrown(() => bodies(reader)) as Error;
    expect((error.cause as SqliteError).code).toBe("SQLITE_BUSY");
    writer.exec("commit");
    expect(bodies(reader)).toHaveLength(401);
  });

  it("refuses the commit while the other connection reads, and commits after the read", () => {
    const { writer, reader } = openPair();
    using _writer = writer;
    using _reader = reader;
    writer.exec("begin immediate");
    writer.db.insert(note).values({ body: "pending" }).run();
    reader.exec("begin; select count(*) from note");
    const error = thrown(() => writer.exec("commit"));
    expect((error as SqliteError).code).toBe("SQLITE_BUSY");
    reader.exec("commit");
    writer.exec("commit");
    expect(bodies(reader)).toEqual(["committed", "pending"]);
  });
});

class MemoryFileHandle {
  readonly kind = "file";
  bytes = new Uint8Array(0);
  async createSyncAccessHandle() {
    return {
      getSize: () => this.bytes.length,
      read: (target: Uint8Array, { at }: { at: number }) => {
        const part = this.bytes.subarray(at, at + target.length);
        target.set(part);
        return part.length;
      },
      write: (source: Uint8Array, { at }: { at: number }) => {
        if (at + source.length > this.bytes.length) {
          const grown = new Uint8Array(at + source.length);
          grown.set(this.bytes);
          this.bytes = grown;
        }
        this.bytes.set(source, at);
        return source.length;
      },
      truncate: (size: number) => {
        const cut = new Uint8Array(size);
        cut.set(this.bytes.subarray(0, size));
        this.bytes = cut;
      },
      flush() {},
      close() {},
    };
  }
}

class MemoryDirectoryHandle {
  readonly kind = "directory";
  readonly entries = new Map<
    string,
    MemoryDirectoryHandle | MemoryFileHandle
  >();
  async getDirectoryHandle(name: string) {
    let found = this.entries.get(name);
    if (!found) this.entries.set(name, (found = new MemoryDirectoryHandle()));
    return found;
  }
  async getFileHandle(name: string) {
    let found = this.entries.get(name);
    if (!found) this.entries.set(name, (found = new MemoryFileHandle()));
    return found;
  }
  async removeEntry(name: string) {
    this.entries.delete(name);
  }
  async *[Symbol.asyncIterator]() {
    yield* this.entries;
  }
  files(): MemoryFileHandle[] {
    return [...this.entries.values()].flatMap((entry) =>
      entry instanceof MemoryFileHandle ? [entry] : entry.files(),
    );
  }
}

function releaseOf(version: string): number[] {
  const [release = "", build = ""] = version.split("-build");
  return [...release.split("."), build].map(Number);
}

describe("the pinned engine", () => {
  it("is sqlite-wasm 3.54.1-build1 or later, the first release whose opfs-sahpool locks its files", () => {
    const { version } = require("@sqlite.org/sqlite-wasm/package.json") as {
      version: string;
    };
    const installed = releaseOf(version);
    const order = installed.reduce(
      (found, part, index) =>
        found || part - releaseOf("3.54.1-build1")[index]!,
      0,
    );
    expect(installed.every(Number.isInteger)).toBe(true);
    expect(order).toBeGreaterThanOrEqual(0);
  });

  it("keeps a reader of opfs-sahpool out while the other connection holds an exclusive lock", async () => {
    const root = new MemoryDirectoryHandle();
    vi.stubGlobal("FileSystemHandle", class {});
    vi.stubGlobal("FileSystemDirectoryHandle", MemoryDirectoryHandle);
    vi.stubGlobal("FileSystemFileHandle", MemoryFileHandle);
    vi.stubGlobal("navigator", {
      storage: { getDirectory: async () => root },
    });
    try {
      using pool = await loadSqliteWasm({
        wasm,
        storage: "opfs-sahpool",
        directory: ".lock-pool",
      });
      expect(pool.storage).toBe("opfs-sahpool");
      using writer = pool.open({ file: "/locks.sqlite" });
      writer.exec("create table note (id integer primary key, body text)");
      using reader = pool.open({ file: "/locks.sqlite" });
      expect(root.files().some((file) => file.bytes.length > 4096)).toBe(true);

      writer.exec("begin exclusive");
      const error = thrown(() =>
        reader.exec("select count(*) from sqlite_master"),
      );
      writer.exec("rollback");

      expect(error).toBeInstanceOf(SqliteError);
      expect((error as SqliteError).code).toBe("SQLITE_BUSY");
      reader.exec("select count(*) from sqlite_master");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("renewing the Drizzle database", () => {
  it("gives a new database object over the same connection and finalizes every prepared statement of the connection", () => {
    using database = openNotes(["kept"]);
    const base = openStatements(database);
    for (let round = 0; round < 5; round++) {
      const statement = database.db
        .select({ body: note.body })
        .from(note)
        .where(eq(note.id, sql.placeholder("id")))
        .prepare();
      expect(statement.get({ id: 1 })).toEqual({ body: "kept" });
      expect(openStatements(database)).toBe(base + 1);
      const before = database.db;
      const renewed = database.renew();
      expect(renewed).not.toBe(before);
      expect(database.db).toBe(renewed);
      expect(openStatements(database)).toBe(base);
      expect(statement.get({ id: 1 })).toEqual({ body: "kept" });
      database.renew();
    }
    expect(openStatements(database)).toBe(base);
    expect(database.db.select().from(note).all()).toEqual([
      { id: 1, body: "kept" },
    ]);
  });
});

describe("file names", () => {
  it.each([
    "my thesis#1.sqlite",
    "a?b.sqlite",
    ":memory:",
    "",
    "/",
    "dir/a.sqlite",
    "..",
    "論文.sqlite",
  ])("refuses the name %j, which the pool cannot key as given", (file) => {
    const error = thrown(() => sqlite.open({ file }));
    expect(error).toBeInstanceOf(SqliteError);
    expect((error as SqliteError).code).toBe("SQLITE_CANTOPEN");
  });
});

describe("closing", () => {
  it("closes each open database when the module closes, and keeps it closed", async () => {
    const loaded = await loadSqliteWasm({ wasm, storage: "memory" });
    const database = loaded.open({ file: "/closing.sqlite" });
    const bytes = database.export();
    loaded.close();
    expect(() => database.db.all(sql`select 1`)).toThrow();
    const error = thrown(() => database.import(bytes));
    expect((error as SqliteError).code).toBe("SQLITE_MISUSE");
    expect(() => database.db.all(sql`select 1`)).toThrow();
  });

  it("refuses an open after the module closes, and closes twice without an error", async () => {
    const loaded = await loadSqliteWasm({ wasm, storage: "memory" });
    loaded.close();
    loaded.close();
    const error = thrown(() => loaded.open({ file: "/after.sqlite" }));
    expect(error).toBeInstanceOf(SqliteError);
    expect((error as SqliteError).code).toBe("SQLITE_MISUSE");
  });

  it("closes a database twice without an error, and refuses an import after it", () => {
    const database = openNotes();
    const bytes = database.export();
    database.close();
    database.close();
    const error = thrown(() => database.import(bytes));
    expect(error).toBeInstanceOf(SqliteError);
    expect((error as SqliteError).code).toBe("SQLITE_MISUSE");
  });
});
