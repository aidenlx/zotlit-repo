import type {
  BindableValue,
  Database,
  PreparedStatement,
  Sqlite3Static,
} from "@sqlite.org/sqlite-wasm";
import { entityKind, NoopLogger, sql } from "drizzle-orm";
import type {
  AnyRelations,
  DrizzleTypeError,
  Logger,
  Query,
} from "drizzle-orm";
import {
  SQLiteAsyncPreparedQuery,
  SQLiteAsyncSession,
  SQLiteAsyncTransaction,
} from "drizzle-orm/sqlite-core";
import type {
  SQLiteAsyncPreparedQueryConfig,
  SQLiteDialect,
  SQLiteExecuteMethod,
  SQLiteQueryExecutors,
  SQLiteTransactionConfig,
} from "drizzle-orm/sqlite-core";

import { toSqliteError } from "./errors.ts";

export interface SqliteWasmRunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

export interface SqliteWasmConnection {
  readonly sqlite3: Sqlite3Static;
  readonly generation: number;
  database(): Database;
  keep(statement: PreparedStatement): void;
  take(sql: string): PreparedStatement;
  give(sql: string, statement: PreparedStatement): void;
}

export interface SqliteWasmSessionOptions<TRelations extends AnyRelations> {
  connection: SqliteWasmConnection;
  relations: TRelations;
  logger?: Logger | undefined;
  paramsInErrors?: boolean | undefined;
}

type PreparedQueryConfig = Omit<
  SQLiteAsyncPreparedQueryConfig,
  "statement" | "run"
>;

type Row = unknown[] | Record<string, unknown>;

function runKeepingError(rollback: () => unknown): void {
  try {
    rollback();
  } catch {
    return;
  }
}

function safeInteger(value: bigint): number | bigint {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : value;
}

export class SqliteWasmSession<
  TRelations extends AnyRelations,
> extends SQLiteAsyncSession<"sync", SqliteWasmRunResult, TRelations> {
  static override readonly [entityKind]: string = "SqliteWasmSession";

  readonly #connection: SqliteWasmConnection;
  readonly #relations: TRelations;
  readonly #paramsInErrors: boolean | undefined;
  readonly #logger: Logger;

  constructor(
    dialect: SQLiteDialect,
    options: SqliteWasmSessionOptions<TRelations>,
  ) {
    super(dialect, "sync");
    this.#connection = options.connection;
    this.#relations = options.relations;
    this.#paramsInErrors = options.paramsInErrors;
    this.#logger = options.logger ?? new NoopLogger();
  }

  prepareQuery<T extends Omit<PreparedQueryConfig, "run">>(
    query: Query,
    mode: "arrays" | "objects" | "raw",
    prepare: boolean,
    executeMethod?: SQLiteExecuteMethod,
    mapper?: (rows: any[]) => any,
  ): SQLiteAsyncPreparedQuery<T & { run: SqliteWasmRunResult }> {
    const connection = this.#connection;
    const { capi } = connection.sqlite3;
    const readBigInts = mapper !== undefined;
    let kept: { statement: PreparedStatement; generation: number } | undefined;

    const use = <R>(
      params: unknown[],
      read: (statement: PreparedStatement) => R,
    ): R => {
      try {
        let statement: PreparedStatement;
        let release: () => void;
        if (prepare) {
          if (kept?.generation !== connection.generation) {
            kept = {
              statement: connection.database().prepare(query.sql),
              generation: connection.generation,
            };
            connection.keep(kept.statement);
          }
          statement = kept.statement;
          release = () => statement.resetNoThrow(true);
        } else {
          statement = connection.take(query.sql);
          release = () => connection.give(query.sql, statement);
        }
        try {
          if (params.length > 0) statement.bind(params as BindableValue[]);
          return read(statement);
        } finally {
          release();
        }
      } catch (error) {
        throw toSqliteError(connection.sqlite3, error);
      }
    };

    const column = (statement: PreparedStatement, index: number) =>
      readBigInts &&
      capi.sqlite3_column_type(statement, index) === capi.SQLITE_INTEGER
        ? capi.sqlite3_column_int64(statement, index)
        : statement.get(index);

    const row = (statement: PreparedStatement, names: string[]): Row => {
      if (mode === "arrays") {
        return names.map((_, index) => column(statement, index));
      }
      const object: Record<string, unknown> = {};
      for (const [index, name] of names.entries()) {
        object[name] = column(statement, index);
      }
      return object;
    };

    const executors: SQLiteQueryExecutors<"sync"> = {
      all: (params) =>
        use(params, (statement) => {
          const rows: Row[] = [];
          let names: string[] | undefined;
          while (statement.step()) {
            names ??= statement.getColumnNames();
            rows.push(row(statement, names));
          }
          return rows;
        }),
      get: (params) =>
        use(params, (statement) =>
          statement.step()
            ? row(statement, statement.getColumnNames())
            : undefined,
        ),
      run: (params) =>
        use(params, (statement): SqliteWasmRunResult => {
          while (statement.step());
          const database = connection.database();
          return {
            changes: database.changes(),
            lastInsertRowid: safeInteger(
              capi.sqlite3_last_insert_rowid(database),
            ),
          };
        }),
    };

    return new SQLiteAsyncPreparedQuery(
      "sync",
      executeMethod,
      executors,
      query,
      mapper,
      mode,
      this.#logger,
      this.#paramsInErrors,
    );
  }

  override transaction<T>(
    transaction: (tx: SqliteWasmTransaction<TRelations>) => T,
    config: SQLiteTransactionConfig = {},
  ): T {
    if (config.behavior === "concurrent") {
      throw new Error("Concurrent transactions are not supported by driver");
    }
    const tx = new SqliteWasmTransaction(
      "sync",
      this.dialect,
      this,
      this.#relations,
    );
    this.run(sql.raw(`begin${config.behavior ? ` ${config.behavior}` : ""}`));
    try {
      const result = transaction(tx);
      this.run(sql`commit`);
      return result;
    } catch (error) {
      runKeepingError(() => this.run(sql`rollback`));
      throw error;
    }
  }
}

export class SqliteWasmTransaction<
  TRelations extends AnyRelations,
> extends SQLiteAsyncTransaction<"sync", SqliteWasmRunResult, TRelations> {
  static override readonly [entityKind]: string = "SqliteWasmTransaction";

  override transaction<T>(
    transaction: (
      tx: SqliteWasmTransaction<TRelations>,
    ) => T extends Promise<any>
      ? DrizzleTypeError<"Sync drivers can't use async functions in transactions!">
      : T,
  ): T {
    const savepoint = `sp${this.nestedIndex + 1}`;
    const tx = new SqliteWasmTransaction(
      "sync",
      this._.session.dialect,
      this._.session,
      this._.relations,
      this.nestedIndex + 1,
    );
    tx.run(sql.raw(`savepoint ${savepoint}`));
    try {
      const result = transaction(tx);
      tx.run(sql.raw(`release savepoint ${savepoint}`));
      return result as T;
    } catch (error) {
      runKeepingError(() =>
        tx.run(sql.raw(`rollback to savepoint ${savepoint}`)),
      );
      throw error;
    }
  }
}
