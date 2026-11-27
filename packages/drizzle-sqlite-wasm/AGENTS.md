# @zotlit/drizzle-sqlite-wasm

A Drizzle SQLite database in the synchronous result mode over the object API (oo1) of `@sqlite.org/sqlite-wasm`. The package is generic: it knows no schema and no Zotero, ZotLit or Obsidian module; a caller gives its own relations (`@zotlit/db/client/wasm` gives the Zotero ones).

The package is in the Worker zone (`zotlit.layer: "worker"`): web APIs only. Tests run in Node.

## Where a change goes

- `src/sqlite-wasm.ts` — the load (`loadSqliteWasm`), the storages (`memory` and `opfs-sahpool`), the open, import, export and removal (a removal also deletes the file's `-journal` and `-wal`). The exported types there are the interface.
- `src/session.ts` — the Drizzle session; it follows the `sql-js` session of Drizzle 1.0.0-rc.6 (`drizzle-orm/src/sql-js`, `node-sqlite`).
- `src/codecs.ts` — the integer and blob codecs, those of the Drizzle `node-sqlite` driver, so a query reads the same values as the Node client of `@zotlit/db`.
- `src/errors.ts` — every error that leaves the package, other than a wasm compile or link error at load, is a `SqliteError` or a `StorageError`.

## Invariants

A change keeps each of these; the named case of `src/sqlite-wasm.test.ts` holds it.

- The package never fetches the wasm and never falls back from `opfs-sahpool` to memory storage on its own ("gives a typed error when opfs-sahpool cannot open").
- The load turns off the `opfs` VFSes and runs one load at a time, because the engine reads its configuration from a global ("loads three times at once with no line on the console").
- The `jit` probe needs `new Function`, so `no-implied-eval` is off for `src/sqlite-wasm.ts` in `oxlint.config.ts`; the release ESLint needs the same exception when this package joins the reviewed sources.
- Statements that are not prepared come from a bounded cache of the connection, because wasm memory has no garbage collection ("at most 64"); `renew`, `import` and `close` finalize them ("finalizes every prepared statement").

## Tests

`src/sqlite-wasm.test.ts` runs `describeDriverConformance` from `@zotlit/db-testing/conformance` on memory storage with the real wasm. `vitest.config.ts` resolves `@sqlite.org/sqlite-wasm` to its browser build, the build that a Worker bundle gets. Node has no OPFS: without it `opfs-sahpool` fails with `StorageError` `reason: "unavailable"`.
