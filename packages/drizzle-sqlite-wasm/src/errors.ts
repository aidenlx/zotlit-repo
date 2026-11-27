import type { Sqlite3Static } from "@sqlite.org/sqlite-wasm";

export type StorageKind = "memory" | "opfs-sahpool";

export type StorageFailure = "unavailable" | "capacity" | "failed";

export class StorageError extends Error {
  override readonly name = "StorageError";
  readonly storage: StorageKind;
  readonly reason: StorageFailure;

  constructor(
    message: string,
    options: ErrorOptions & { storage: StorageKind; reason: StorageFailure },
  ) {
    super(message, options);
    this.storage = options.storage;
    this.reason = options.reason;
  }
}

export class SqliteError extends Error {
  override readonly name = "SqliteError";
  readonly resultCode: number;
  readonly code: string;

  constructor(
    message: string,
    options: ErrorOptions & { resultCode: number; code: string },
  ) {
    super(message, options);
    this.resultCode = options.resultCode;
    this.code = options.code;
  }
}

export function toSqliteError(sqlite3: Sqlite3Static, error: unknown): unknown {
  if (!(error instanceof sqlite3.SQLite3Error)) return error;
  return new SqliteError(error.message, {
    resultCode: error.resultCode,
    code: sqlite3.capi.sqlite3_js_rc_str(error.resultCode),
    cause: error,
  });
}

export function sqliteError(
  sqlite3: Sqlite3Static,
  resultCode: number,
  message: string,
): SqliteError {
  return new SqliteError(message, {
    resultCode,
    code: sqlite3.capi.sqlite3_js_rc_str(resultCode),
  });
}

export function storageError(
  storage: StorageKind,
  reason: StorageFailure,
  error: unknown,
): StorageError {
  if (error instanceof StorageError) return error;
  return new StorageError(
    error instanceof Error ? error.message : String(error),
    { storage, reason, cause: error },
  );
}
