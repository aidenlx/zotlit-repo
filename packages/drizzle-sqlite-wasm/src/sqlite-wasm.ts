import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import type {
  Database,
  PreparedStatement,
  SAHPoolUtil,
  Sqlite3Static,
} from "@sqlite.org/sqlite-wasm";
import { DefaultLogger } from "drizzle-orm";
import type { AnyRelations, EmptyRelations, Logger } from "drizzle-orm";
import { SQLiteAsyncDatabase, SQLiteDialect } from "drizzle-orm/sqlite-core";
import type { DrizzleSQLiteConfig } from "drizzle-orm/sqlite-core";

import { sqliteWasmCodecs } from "./codecs.ts";
import { sqliteError, storageError, toSqliteError } from "./errors.ts";
import type { StorageKind } from "./errors.ts";
import { SqliteWasmSession } from "./session.ts";
import type { SqliteWasmConnection, SqliteWasmRunResult } from "./session.ts";

export type SqliteWasmBinary = BufferSource | WebAssembly.Module;

export type LoadSqliteWasmOptions = { wasm: SqliteWasmBinary } & (
  | { storage: "memory" }
  | { storage: "opfs-sahpool"; directory?: string }
);

export type OpenSqliteWasmOptions<TRelations extends AnyRelations> =
  DrizzleSQLiteConfig<TRelations> & {
    file: string;
    readOnly?: boolean;
  };

export type SqliteWasmDrizzle<
  TRelations extends AnyRelations = EmptyRelations,
> = SQLiteAsyncDatabase<"sync", SqliteWasmRunResult, TRelations>;

export interface SqliteWasmDatabase<
  TRelations extends AnyRelations = EmptyRelations,
> extends Disposable {
  readonly db: SqliteWasmDrizzle<TRelations>;
  readonly file: string;
  renew(): SqliteWasmDrizzle<TRelations>;
  cacheStatus(): CacheStatus;
  inTransaction(): boolean;
  exec(sql: string): void;
  export(): Uint8Array;
  import(bytes: Uint8Array | ArrayBuffer): void;
  close(): void;
}

export interface CacheStatus {
  readonly used: number;
  readonly spills: number;
}

export interface SqliteWasm extends Disposable {
  readonly version: string;
  readonly storage: StorageKind;
  open<TRelations extends AnyRelations = EmptyRelations>(
    options: OpenSqliteWasmOptions<TRelations>,
  ): SqliteWasmDatabase<TRelations>;
  remove(file: string): boolean;
  close(): void;
}

interface Storage {
  readonly kind: StorageKind;
  readonly vfs: string | undefined;
  read(file: string, database: Database): Uint8Array;
  write(file: string, bytes: Uint8Array): void;
  openFailure(open: {
    file: string;
    readOnly: boolean;
    error: unknown;
  }): unknown;
  remove(file: string): boolean;
  release(): void;
}

type InitModule = (module: {
  instantiateWasm(
    imports: WebAssembly.Imports,
    receive: (instance: WebAssembly.Instance) => void,
  ): object;
}) => Promise<Sqlite3Static>;

const DATABASE_HEADER = new TextEncoder().encode("SQLite format 3\0");
const PAGE_UNIT = 512;
const STATEMENT_CACHE_SIZE = 64;
const FILE_NAME = /^\/?(?!\.{1,2}$)[\w.-]+$/;

const API_CONFIG = { disable: { vfs: { opfs: true, "opfs-wl": true } } };

let engineLoads: Promise<void> = Promise.resolve();

function instantiate(wasm: SqliteWasmBinary): Promise<Sqlite3Static> {
  const load = engineLoads.then(() => instantiateAlone(wasm));
  engineLoads = load.then(
    () => undefined,
    () => undefined,
  );
  return load;
}

async function instantiateAlone(
  wasm: SqliteWasmBinary,
): Promise<Sqlite3Static> {
  const init = sqlite3InitModule as unknown as InitModule;
  const scope = globalThis as { sqlite3ApiConfig?: unknown };
  scope.sqlite3ApiConfig = API_CONFIG;
  return new Promise<Sqlite3Static>((resolve, reject) => {
    init({
      instantiateWasm(imports, receive) {
        const instance =
          wasm instanceof WebAssembly.Module
            ? WebAssembly.instantiate(wasm, imports)
            : WebAssembly.instantiate(wasm, imports).then(
                (source) => source.instance,
              );
        void instance.then(receive, reject);
        return {};
      },
    }).then(resolve, reject);
  }).finally(() => {
    if (scope.sqlite3ApiConfig === API_CONFIG) delete scope.sqlite3ApiConfig;
  });
}

function memoryStorage(sqlite3: Sqlite3Static): Storage {
  return {
    kind: "memory",
    vfs: "unix",
    read(_file, database) {
      return sqlite3.capi.sqlite3_js_db_export(database);
    },
    write(file, bytes) {
      const copy = bytes.slice();
      copy[18] = 1;
      copy[19] = 1;
      try {
        sqlite3.capi.sqlite3_js_posix_create_file(file, copy);
      } catch (error) {
        throw storageError("memory", "failed", error);
      }
    },
    openFailure: ({ error }) => toSqliteError(sqlite3, error),
    remove(file) {
      const unlink = sqlite3.wasm.xWrap("sqlite3__wasm_vfs_unlink", "int", [
        "sqlite3_vfs*",
        "string",
      ]) as (vfs: number, file: string) => number;
      const removed = unlink(0, file) === sqlite3.capi.SQLITE_OK;
      unlink(0, `${file}-journal`);
      return removed;
    },
    release() {},
  };
}

async function sahPoolStorage(
  sqlite3: Sqlite3Static,
  options: { directory?: string },
): Promise<Storage> {
  let pool: SAHPoolUtil;
  try {
    pool = await sqlite3.installOpfsSAHPoolVfs({
      directory: options.directory,
      preserveOnInitFailure: true,
    });
  } catch (error) {
    throw storageError("opfs-sahpool", "unavailable", error);
  }
  const capacityError = (file: string, cause: unknown) =>
    storageError(
      "opfs-sahpool",
      "capacity",
      new Error(
        `the opfs-sahpool storage has no free slot for ${file} (capacity ${pool.getCapacity()})`,
        { cause },
      ),
    );
  return {
    kind: "opfs-sahpool",
    vfs: pool.vfsName,
    read(file) {
      try {
        return pool.exportFile(file);
      } catch (error) {
        throw storageError("opfs-sahpool", "failed", error);
      }
    },
    write(file, bytes) {
      try {
        void pool.importDb(file, bytes);
      } catch (error) {
        throw storageError("opfs-sahpool", "failed", error);
      }
    },
    openFailure({ file, readOnly, error }) {
      if (
        error instanceof sqlite3.SQLite3Error &&
        (error.resultCode & 0xff) === sqlite3.capi.SQLITE_CANTOPEN &&
        !readOnly &&
        !pool.getFileNames().includes(file) &&
        pool.getFileCount() >= pool.getCapacity()
      ) {
        return capacityError(file, error);
      }
      return toSqliteError(sqlite3, error);
    },
    remove(file) {
      try {
        pool.unlink(`${file}-journal`);
        return pool.unlink(file);
      } catch (error) {
        throw storageError("opfs-sahpool", "failed", error);
      }
    },
    release() {
      try {
        pool.pauseVfs();
      } catch (error) {
        throw storageError("opfs-sahpool", "failed", error);
      }
    },
  };
}

function fileName(sqlite3: Sqlite3Static, file: string): string {
  if (!FILE_NAME.test(file)) {
    throw sqliteError(
      sqlite3,
      sqlite3.capi.SQLITE_CANTOPEN,
      `the file name ${JSON.stringify(file)} is not one name of letters, digits, ".", "_" or "-"`,
    );
  }
  return file.startsWith("/") ? file : `/${file}`;
}

function jitMappers(jit: boolean | undefined): boolean {
  if (jit !== true) return false;
  try {
    return new Function("return true")() === true;
  } catch {
    return false;
  }
}

function databaseBytes(
  sqlite3: Sqlite3Static,
  bytes: Uint8Array | ArrayBuffer,
): Uint8Array {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const header = DATABASE_HEADER.every((byte, index) => data[index] === byte);
  if (!header || data.byteLength < PAGE_UNIT || data.byteLength % PAGE_UNIT) {
    throw sqliteError(
      sqlite3,
      sqlite3.capi.SQLITE_NOTADB,
      "file is not a database",
    );
  }
  return data;
}

function logger(option: boolean | Logger | undefined): Logger | undefined {
  if (option === true) return new DefaultLogger();
  if (option === false) return undefined;
  return option;
}

class Connection implements SqliteWasmConnection {
  readonly sqlite3: Sqlite3Static;
  readonly file: string;
  readonly #storage: Storage;
  readonly #readOnly: boolean;
  #generation = 0;
  #current: Database | undefined;
  readonly #kept = new Set<PreparedStatement>();
  readonly #cached = new Map<string, PreparedStatement>();
  #issued = new WeakSet<PreparedStatement>();

  constructor(options: {
    sqlite3: Sqlite3Static;
    storage: Storage;
    file: string;
    readOnly: boolean;
  }) {
    this.sqlite3 = options.sqlite3;
    this.#storage = options.storage;
    this.file = fileName(options.sqlite3, options.file);
    this.#readOnly = options.readOnly;
    this.#current = this.#connect();
  }

  get generation(): number {
    return this.#generation;
  }

  keep(statement: PreparedStatement): void {
    this.#kept.add(statement);
  }

  renew(): void {
    this.database();
    this.#generation++;
    for (const statement of this.#kept) statement.finalize();
    this.#kept.clear();
    this.#dropCached();
  }

  take(sql: string): PreparedStatement {
    const statement = this.#cached.get(sql);
    if (statement) {
      this.#cached.delete(sql);
      return statement;
    }
    const prepared = this.database().prepare(sql);
    this.#issued.add(prepared);
    return prepared;
  }

  give(sql: string, statement: PreparedStatement): void {
    if (!this.#issued.has(statement) || this.#cached.has(sql)) {
      statement.finalize();
      return;
    }
    statement.resetNoThrow(true);
    this.#cached.set(sql, statement);
    if (this.#cached.size > STATEMENT_CACHE_SIZE) {
      const [oldest, evicted] = this.#cached.entries().next().value!;
      this.#cached.delete(oldest);
      evicted.finalize();
    }
  }

  #dropCached(): void {
    for (const statement of this.#cached.values()) statement.finalize();
    this.#cached.clear();
    this.#issued = new WeakSet();
  }

  inTransaction(): boolean {
    return this.sqlite3.capi.sqlite3_get_autocommit(this.database()) === 0;
  }

  cacheStatus(): CacheStatus {
    const database = this.database();
    const { capi, wasm } = this.sqlite3;
    const status = (op: Parameters<typeof capi.sqlite3_db_status>[1]) => {
      const stack = wasm.pstack.pointer;
      try {
        const current = wasm.pstack.alloc(4);
        const highwater = wasm.pstack.alloc(4);
        const rc = capi.sqlite3_db_status(database, op, current, highwater, 0);
        if (rc !== capi.SQLITE_OK) {
          throw sqliteError(this.sqlite3, rc, "sqlite3_db_status failed");
        }
        return wasm.peek32(current);
      } finally {
        wasm.pstack.restore(stack);
      }
    };
    return {
      used: status(capi.SQLITE_DBSTATUS_CACHE_USED),
      spills: status(capi.SQLITE_DBSTATUS_CACHE_SPILL),
    };
  }

  database(): Database {
    if (this.#current) return this.#current;
    throw sqliteError(
      this.sqlite3,
      this.sqlite3.capi.SQLITE_MISUSE,
      `the database ${this.file} is closed`,
    );
  }

  #connect(): Database {
    this.#generation++;
    this.#kept.clear();
    try {
      return new this.sqlite3.oo1.DB({
        filename: this.file,
        flags: this.#readOnly ? "r" : "c",
        vfs: this.#storage.vfs,
      });
    } catch (error) {
      throw this.#storage.openFailure({
        file: this.file,
        readOnly: this.#readOnly,
        error,
      });
    }
  }

  close(): void {
    const current = this.#current;
    this.#dropCached();
    this.#current = undefined;
    this.#generation++;
    this.#kept.clear();
    current?.close();
  }

  exec(sql: string): void {
    try {
      this.database().exec(sql);
    } catch (error) {
      throw toSqliteError(this.sqlite3, error);
    }
  }

  export(): Uint8Array {
    const database = this.database();
    try {
      return this.#storage.read(this.file, database);
    } catch (error) {
      throw toSqliteError(this.sqlite3, error);
    }
  }

  import(bytes: Uint8Array | ArrayBuffer): void {
    const database = this.database();
    if (this.#readOnly) {
      throw sqliteError(
        this.sqlite3,
        this.sqlite3.capi.SQLITE_READONLY,
        `attempt to write a readonly database: ${this.file} is open read-only`,
      );
    }
    const data = databaseBytes(this.sqlite3, bytes);
    this.#dropCached();
    this.#current = undefined;
    this.#generation++;
    database.close();
    try {
      this.#storage.write(this.file, data);
    } finally {
      this.#current = this.#connect();
    }
  }
}

interface Engine {
  readonly sqlite3: Sqlite3Static;
  readonly storage: Storage;
  readonly onClose: (database: SqliteWasmDatabase<any>) => void;
}

function openDatabase<TRelations extends AnyRelations>(
  { sqlite3, storage, onClose }: Engine,
  options: OpenSqliteWasmOptions<TRelations>,
): SqliteWasmDatabase<TRelations> {
  const connection = new Connection({
    sqlite3,
    storage,
    file: options.file,
    readOnly: options.readOnly === true,
  });
  const dialect = new SQLiteDialect({
    codecs: options.codecs ?? sqliteWasmCodecs,
    useJitMappers: jitMappers(options.jit),
  });
  const relations = options.relations ?? ({} as TRelations);
  const drizzle = () =>
    new SQLiteAsyncDatabase<"sync", SqliteWasmRunResult, TRelations>(
      "sync",
      dialect,
      new SqliteWasmSession(dialect, {
        connection,
        relations,
        logger: logger(options.logger),
        paramsInErrors: options.paramsInErrors,
      }),
      relations,
    );
  let db = drizzle();
  const database: SqliteWasmDatabase<TRelations> = {
    get db() {
      return db;
    },
    file: connection.file,
    renew() {
      connection.renew();
      db = drizzle();
      return db;
    },
    cacheStatus() {
      return connection.cacheStatus();
    },
    inTransaction() {
      return connection.inTransaction();
    },
    exec(sql) {
      connection.exec(sql);
    },
    export() {
      return connection.export();
    },
    import(bytes) {
      connection.import(bytes);
    },
    close() {
      connection.close();
      onClose(database);
    },
    [Symbol.dispose]() {
      database.close();
    },
  };
  return database;
}

export async function loadSqliteWasm(
  options: LoadSqliteWasmOptions,
): Promise<SqliteWasm> {
  const sqlite3 = await instantiate(options.wasm);
  const storage =
    options.storage === "memory"
      ? memoryStorage(sqlite3)
      : await sahPoolStorage(sqlite3, options);
  const open = new Set<SqliteWasmDatabase<any>>();
  let closed = false;
  const engine: Engine = {
    sqlite3,
    storage,
    onClose: (database) => open.delete(database),
  };
  const close = () => {
    if (closed) return;
    closed = true;
    for (const database of open) database.close();
    storage.release();
  };
  return {
    version: sqlite3.version.libVersion,
    storage: storage.kind,
    open(databaseOptions) {
      if (closed) {
        throw sqliteError(
          sqlite3,
          sqlite3.capi.SQLITE_MISUSE,
          "the sqlite-wasm module is closed",
        );
      }
      const database = openDatabase(engine, databaseOptions);
      open.add(database);
      return database;
    },
    remove(file) {
      const name = fileName(sqlite3, file);
      if (closed || [...open].some((database) => database.file === name)) {
        throw sqliteError(
          sqlite3,
          sqlite3.capi.SQLITE_MISUSE,
          closed
            ? "the sqlite-wasm module is closed"
            : `the database ${name} is open`,
        );
      }
      return storage.remove(name);
    },
    close,
    [Symbol.dispose]: close,
  };
}
