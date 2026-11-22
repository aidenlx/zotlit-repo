import type { relations } from "#drizzle/relations.ts";
import type { SQLiteAsyncDatabase } from "drizzle-orm/sqlite-core";

export type ZoteroDatabase = SQLiteAsyncDatabase<
  "sync",
  unknown,
  typeof relations
>;
