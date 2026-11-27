import type { Logger } from "drizzle-orm";

import type {
  SqliteWasm,
  SqliteWasmDatabase,
} from "@zotlit/drizzle-sqlite-wasm";

import { relations } from "#drizzle/relations.ts";

export interface WasmClientOptions {
  file: string;
  readOnly?: boolean;
  jit?: boolean;
  logger?: boolean | Logger;
}

export type WasmDatabaseClient = SqliteWasmDatabase<typeof relations>;

export function openWasmClient(
  sqlite: SqliteWasm,
  options: WasmClientOptions,
): WasmDatabaseClient {
  return sqlite.open({ ...options, relations });
}
