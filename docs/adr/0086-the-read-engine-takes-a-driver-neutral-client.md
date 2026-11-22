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

## Layout compatibility

The synchronous Layout module inspects SQLite table and view columns once per client. The Item Query adapter shares its builders and cache and reports its initial probe through the statement observer. It reads the version stamps when the version table has the expected columns. Stamps are for logging. The actual tables and columns decide which copies the readers can use.

Keep the required layout manifest aligned with all Item Query statements and the shared Library lookup. Mark columns that can be absent as optional and check for them before selecting them. The Library reader omits `libraries.clientVersion` when it is absent. A missing core table identifies a file outside the Zotero database contract. Report one gap for a missing table, or one gap for each missing column in a present table.

The manifest test imports all reader modules and compiles their SQL under the SQLite authorizer. Count only reads of real schema tables and views so table-valued functions do not become manifest entries. Keep the first layout result for the client's life. A later schema edit can still cause a driver statement error. Tests that need a fresh layout open a new client.

## Shared synchronous query helpers

Keep declared placeholder names and bound values checked at TypeScript call sites. A query with no placeholders takes no arguments. A declared object shape requires that shape, and an unqualified query keeps Drizzle's optional parameter record. Preserve narrow literals in relational-query configuration so a shared projection still type-checks after it is spread into a call.

Cache prepared statements by client and by sorted builder arguments. Restrict the argument values to JSON-compatible primitives and flat arrays. Omit unset keys so different builder arguments cannot collapse into the same serialized key. Keep the uncached builder callable for SQL inspection. Bind keyed membership as a single JSON array so key count does not change the statement shape. Skip empty requests and return hits in input order, including duplicates. A keyed query selects independent rows, leaving global limits and aggregates to other readers.

Resolve physical Item IDs across Libraries without a caller-supplied Library scope. A display reference reads the key, owning Library, and title without hydrating the Item. Batch callers can reuse a Library-to-group lookup cache. Keep Library metadata raw so the host can localize its labels.

The tested schema-version range is advisory. Report the stored stamps and whether both fall within that range. Let each caller handle an untested version, because a newer Zotero copy can still have the columns the reader requires. The layout check continues to decide which SQL can run.

Bind Library IDs at execution time on cached statements. A statement prepared for one Library must still accept a different Library on its next call. Item IDs are global within one database, so a batch can span Libraries and derive each Indexed Key from its own row. Read Zotero's timestamp text as UTC, and compare epoch milliseconds in tests to avoid a dependency on the runner's time zone.

## Schema mapping and tool entry points

Preserve Zotero column spelling during introspection. The config uses JavaScript because the TypeScript loader failed to pass the nested casing option through validation when introspection was set up. The schema represents SQLite columns with no declared type without forcing affinity. Use the timestamp mapping for untyped date columns, and the integer type for untyped foreign keys to an integer primary key. Interpret timestamps as UTC strings. Narrow Annotation position data in the reader because PDFs, EPUBs, and snapshots carry different shapes.

Database code generation runs TypeScript source directly in Node. Its lint rules permit the source import paths the generator needs, and the Node SQLite adapter remains the production entry that can import Node.
