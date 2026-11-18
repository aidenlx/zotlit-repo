import type { relations } from "#drizzle/relations.ts";
import type { SQLiteAsyncDatabase } from "drizzle-orm/sqlite-core";

/**
 * The client that the read engine takes: a Drizzle SQLite database in the
 * synchronous result mode, over the relations of the Zotero schema. It names
 * no driver, so the same queries run on any synchronous SQLite driver. An
 * adapter, such as `@zotlit/db/client/node`, makes one; every reader takes it
 * as a value. The engine reads only, so the result of a write stays `unknown`:
 * each driver has a result of its own.
 */
export type ZoteroDatabase = SQLiteAsyncDatabase<
  "sync",
  unknown,
  typeof relations
>;
