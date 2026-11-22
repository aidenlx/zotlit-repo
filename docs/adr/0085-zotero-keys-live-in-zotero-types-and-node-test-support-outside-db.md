---
status: accepted
---

# Package edges before the Obsidian plugin is divided

> **Superseded in part by spec [#122](https://github.com/aidenlx/zotlit-repo/issues/122) ([#188](https://github.com/aidenlx/zotlit-repo/issues/188)).** The root package.json has no workspace dependencies. The root config files and the zotlit-query evals reach `@zotlit/config` and `@zotlit/scripts` by path, so a change to one package selects that package and its dependents only. The root-dependency points under "Considered options" and "Consequences" no longer hold.

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

## Fixture and driver contracts

Query tests can create the shared hand-written table subset and insert
only the rows they need. Column defaults reduce the setup needed for
most cases. The scenario tests instead copy the pristine Zotero 10
database so Zotero supplies the lookup tables, triggers, and foreign
keys. Seeds resolve lookup identifiers by name. Indexed Keys identify
rows across libraries because bare keys are only unique within a
library. Seed values that need SQLite's INTEGER storage class bind as
bigints, since Node's SQLite driver binds a JavaScript number as REAL.

A scenario copy lives in memory by default. File-based tests use a
temporary directory owned by the returned disposable handle. The
optional lowest layout drops the normalized columns from migration
126 and the client version columns from migration 129. It stamps
userdata 125 and compatibility 7. A test project can select that
layout through `ZOTLIT_SCENARIO_LAYOUT`. The template path resolves
relative to the workspace package so the fixture can use the copy in
`@zotlit/scripts` without adding a package dependency back to the
scripts that already depend on DB. A failing client factory should
release the connection and directory.
[Scenario setup cleanup](https://github.com/aidenlx/zotlit-repo/issues/71)

Statement counters wrap preparation before the first query, so later
executions of cached statements are counted as well. The compile
counter measures preparations separately from executions. The bulk
library keeps large responsiveness tests separate from the small
scenario whose tests assert exact rows. Its ordered keys and repeated
groups let the tests exercise limited batches and filters. Bulk
annotation tests use one PDF with mixed annotation kinds.

The small scenario includes field aliases and custom-name collisions,
date precision and unparseable input, case-sensitive tag examples,
collections with repeated leaf names and trashed ancestors, identical
bare keys in different libraries, ties broken by Item key, and live
and trashed child rows. These rows let query tests distinguish stored
values from defaults and normalized projections.

The driver conformance suite uses no Node modules so the same checks
can run against SQLite-WASM in a Worker. It takes factories for fresh
writable and read-only databases. The shared-file lock case needs two
independent connections with no busy timeout and runs only for drivers
that provide that factory. Error checks follow Drizzle's cause chain
to the SQLite message that ZoteroReads reports.
