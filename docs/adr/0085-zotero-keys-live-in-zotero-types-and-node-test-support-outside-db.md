---
status: accepted
---

# Package edges before the Obsidian plugin is divided

## Context

The next step divides `apps/obsidian` into shared packages and gives `@zotlit/db` a driver-neutral SQLite client, so that a mobile host (SQLite-WASM in a Worker, no Node) can run the same read engine. Three edges stood in the way:

- `@zotlit/protocol` depended on `@zotlit/db` for three key guards. A host that loads the wire format also loaded the database layer.
- `@zotlit/db` exported `./test-utils` and `./test-scenario`. Its source held `node:fs`, `node:sqlite` and `node:zlib` code that only tests run.
- The message catalogs (`messages/`, `project.inlang/`) belong to no package. Turbo's package-level `--affected` maps a changed file to the package that holds it, so a commit that edits only a catalog selected no package, and `pnpm verify` ran no typecheck or test for the plugin, the docs or the Workbench.

Turbo requires an acyclic package graph, and a dev dependency counts: `@zotlit/db` cannot dev-depend on a test package that depends on `@zotlit/db`.

## Decision

- **The Zotero key grammar is in `@zotlit/zotero-types`.** `./keys` holds `isItemKey`, `formatIndexedKey`, `parseIndexedKey`, `isIndexedKey` and `ParsedIndexedKey`; `./uri` holds the `zotero://` links that need only a key. The item key and the Indexed Key are Zotero data model vocabulary, and zotero-types imports no workspace package. `itemUri` and `itemWebUrl` stay in db, because they name an Item through the account that holds it.
- **`libraryViewUri` is in `@zotlit/protocol`**, beside `parseShowInLibraryProtocolQuery`: it builds an `obsidian://zotlit/*` link. db reads it from protocol for `zt.librarylink`.
- **Node-only test fixtures are in `@zotlit/db-testing`**, which depends on zotero-types only. Tests depend on it as a dev dependency, db's own tests included. `openScenarioDatabase(connect, options)` takes the client factory, and a test passes `connectClient` from `@zotlit/db/client/node`, so the fixture makes a database and the test connects the driver it tests.
- **`makeItem` stays in db** as `@zotlit/db/item-fixture`. It needs db's base-field and Venue rules and no Node API.
- **`--affected` reads task inputs.** turbo.json sets `futureFlags.affectedUsingTaskInputs`. A task is selected when a changed file matches its `inputs`, and the tasks that depend on it follow. The catalogs stay at the root; each task that reads them names them in its `inputs`. The docs deploy gate, which runs a package-level filter, deploys when the catalogs change.

## Considered options

- **Move the catalogs into a `packages/messages` package.** Rejected: the root package.json depends on `@zotlit/scripts`, which reaches `@zotlit/workbench`, so Turbo reports a root dependency change and selects every package for a message edit.
- **Let `@zotlit/db-testing` depend on `@zotlit/db`.** Rejected: db's own tests then form a package cycle, which Turbo refuses.

## Consequences

- The non-test source of db imports `node:*` only in `src/client/node.ts` and `src/lib/zt-path.ts` (the desktop attachment paths of `./path`).
- A change to a package that the root package.json reaches (directly: config, docs, e2e, obsidian, scripts, zotero; and their dependencies) still selects every package, because Turbo treats it as a root dependency change. The root dependencies on docs, e2e, obsidian and zotero date from the removed `lint:deps` task.
