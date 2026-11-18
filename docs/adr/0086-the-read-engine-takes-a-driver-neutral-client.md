---
status: accepted
---

# The read engine takes a driver-neutral SQLite client

Amends [ADR 0068](0068-the-zotero-database-runs-in-a-web-worker-behind-zoteroreads.md) and [ADR 0066](0066-item-query-is-a-deep-module-with-two-operations.md): the borrowed client of ZoteroReads and Item Query is a `ZoteroDatabase`, not the `node:sqlite` client.

`ZoteroDatabase` (`packages/db/src/client/database.ts`, exported from `@zotlit/db`) is Drizzle's `SQLiteAsyncDatabase<"sync", unknown, typeof relations>`: the SQLite database of Drizzle in the synchronous result mode, over the Zotero relations. Every query, reader, layout read and template context of `@zotlit/db`, the Item Query engine, the Template Workbench snapshot and the ZoteroReads handlers take it as a value.

```text
desktop host / Node test                 mobile host (later)
  @zotlit/db/client/node                   SQLite-WASM adapter in a Web Worker
  (node:sqlite, DatabaseSync)              (opfs-sahpool, synchronous)
          \                                 /
           ──────── ZoteroDatabase ─────────
                        │
     @zotlit/db queries · layout · contexts · item-query readers
     @zotlit/item-query · ZoteroReads handlers · workbench snapshot
```

- **The Drizzle type is the port.** The engine calls only Drizzle: `db.query.*` (RQB v2), `db.select`, `db.$count`, and `.prepare()` with `.all` / `.get`. It opens no transaction, registers no SQL function or collation, and reads no raw handle. So the Drizzle database type is the whole contract, and a raw-statement port would add a seam that nothing calls. The run result stays `unknown`, because each driver has its own (`StatementResultingChanges` for `node:sqlite`, `void` for sql.js) and the engine writes nothing.
- **Adapters are leaves.** `@zotlit/db/client/node` is the one module that imports `node:sqlite`. Its `NodeDatabaseClient` is `ZoteroDatabase` plus the `$client` handle; only the code that opens or closes a connection names it: the desktop source and connection lifecycle of ZoteroReads, and Node tests.
- **One synchronous variant.** The asynchronous `sqlocal` client and the `…Async` query twins had no reader and are gone. The asynchronous boundary stays the ZoteroReads RPC.
- **Conformance.** `describeDriverConformance` (`@zotlit/db-testing/conformance`) states what the engine needs from a driver behind Drizzle: number, text, real and null values, bound parameters, statement reuse, `json_each`, `json_object` / `json_group_array`, `pragma_table_info` over `sqlite_schema`, and synchronous errors whose innermost cause carries the SQLite message (no such table, read-only database, locked database). The file loads no Node module, so a Worker test of a second adapter runs the same cases.
- **Lint boundary.** The source of the engine packages (`db`, `item-query`, `item-lookup`, `filter-expression`, `zotero-types`, `shared`, `protocol`, `templates`) loads no Node built-in (`import/no-nodejs-modules`) and no `obsidian`, `electron` or `@zotlit/db/client/node` (`no-restricted-imports`). Tests, configuration and scripts are outside the rule; `src/client/node.ts` and `src/lib/zt-path.ts` of `@zotlit/db` are the two named Node files.

## Why

A Reader plugin and a Mobile plugin need the same schema, queries and Item Query engine on SQLite-WASM in a Web Worker, where there is no Node. A prototype ran the desktop queries unchanged there through a synchronous shim. The engine was typed against the `node:sqlite` client, so each new host would have needed casts or a second copy of the types.

## Consequences

- A new host writes an adapter that returns a `ZoteroDatabase` and runs the conformance suite on it; no engine file changes.
- Code that closes a connection keeps the adapter's own type, because closing is a driver operation.
- `@zotlit/db-testing` now depends on `drizzle-orm` and `vitest`. Its lockfile entries use the same peer variants as `@zotlit/db`, so the two packages share one copy of each and the Drizzle types are compatible.
