---
status: accepted
---

# ZoteroReads is one package with four layers

## Context

Three Obsidian plugins (desktop ZotLit, ZotLit Reader, ZotLit Mobile) will be thin hosts over shared packages. ZoteroReads ([ADR 0068](0068-the-zotero-database-runs-in-a-web-worker-behind-zoteroreads.md)) is the interface they all share. Its contract, handlers, Worker host, renderer client and desktop database lifecycle lived in `apps/obsidian`, so no other host could use them. On mobile the Worker has no Node: a host there supplies only how the Worker starts and how a `ZoteroDatabase` opens and closes.

## Decision

- **One package, `@zotlit/zotero-reads`, with one `src/` folder per layer:** `contract/` (the RpcGroup, schemas, codecs and shared value types; host-free), `worker/` (the handlers, their readers, the `Connection`, the in-process adapter and `serveZoteroReads`; host-free), `client/` (the renderer service, the Worker client, leases, events, view atoms; no Node or Electron), `desktop/` (the `node:sqlite` source: Read Modes, clones, watches, sweeps). A layer imports the layers below it: contract ← worker, contract ← client, all three ← desktop. Per-folder overrides of `oxlint.config.ts` hold each boundary.
- **The desktop host is a subpath of this package**, not part of `@zotlit/obsidian-desktop`. The code is ZoteroReads' own (Read Mode, refresh lane, clone sweeps), and obsidian-desktop holds helpers that several units share. Only a desktop host imports `@zotlit/zotero-reads/desktop/*`.
- **The host passes its capabilities in.** The `Connection` opens an `OpenClient` (`client` and `close`) from the host's opener. `serveZoteroReads` takes the host's `Connection` layer, its file system, its segmenter store and its Item Query adapter (`QueryJobRunner`). `connectWorker` takes the host's snapshot sweep.
- **The Query Job types belong to the host's Item Query adapter.** The contract reads only `id`, `command` and the decoded query; the host names the full job and answer in `ItemQueryTypes` by declaration merging. The app checks at compile time that the contract carries its `QueryJob` and `QueryAnswer`.

## Considered options

- **Several packages (contract, worker, client, desktop).** Rejected: the folder overrides of one lint config enforce the same boundaries, and four packages add four sets of tasks, tsconfigs and Vitest configs for no boundary that lint misses.
- **Move the Item Query adapter into the package.** Rejected: its worker side reads the Template Workbench envelope, the CLI diagnostics of the Obsidian kit and `node:async_hooks`, which are app and desktop concerns.

## Consequences

- A mobile host writes a Worker entry of a few lines: `serveZoteroReads` with its own `Connection` layer over SQLite-WASM.
- Without a `QueryJobRunner`, an `ItemQuery` request dies. A test that runs Item Query in process passes the app's `queryJobRunner`.
- The package's `src/` is in the `effectEntry` scopes of the app's builds and tests, in `pnpm review`, and in knip.

## Contract codecs

The contract checks that decoded row types are mutually assignable with their database types. The codecs pass database-owned JSON shapes through and accept numbers for mapped Zotero integers, so a new upstream value can reach the database layer's unknown-name fallback. Encode Temporal instants as ISO strings because the worker's structured clone cannot carry a Temporal Instant. [Invalid instant follow-up](https://github.com/aidenlx/zotlit-repo/issues/84)

The host supplies full Query Job and answer types through declaration merging. The job envelope keeps ordinary data and encodes the decoded query or values listing through its own codec. Omitted arguments stay absent. A null Library argument uses the current Library Scope. The formula map crosses as a record and becomes a dictionary without a prototype, so names such as `__proto__` remain ordinary formula names. CLI answers are JSON. CSV and TSV apply to file output. The cancellation operation uses the job id, and the Query Context can supply the current item and attachment.

## Library Scope

Persist stable selectors for My Library and Zotero groups. Local library ids can change between databases, and group names can change independently of a selection. A saved selection must be non-empty, unique, and sorted with My Library first and groups in ascending group-id order. The wire codec checks the form. The saved settings validator checks canonical order and membership invariants. A new installation uses All Libraries. A broken saved selection stays on disk and resolves to My Library with an invalid flag until the user repairs it. My Library also supplies the initial selection when switching from All Libraries.

Resolve selectors against one database snapshot and preserve unresolved selectors. Compare both names and local library ids when deciding whether a resolution changed. This updates mounted labels after a rename and rebuilds dependent state when a returning group gets another local id. The order tests use local ids that differ from group order so sorting by the wrong id cannot pass.

## Test adapters

Use the same in-process RPC layer for package tests and consumers. The opener can create a fresh memory database on each borrow lifecycle. A test can make a particular open fail and record the order of opens and closes. A test that owns its own SQLite handle can lend the connection a facade with a no-op close. A consumer test can hold startup or record RPC payloads and the Snapshot ids its calls establish. The fixture with fixed state still dispatches reads through the real handlers, so mocked database functions run behind the normal operation contract.

Some consumer fixtures construct synchronously. Calls during fixture startup wait for the managed runtime to load its service. The small answer stub checks each supplied input and result against the RPC operation type. It casts once at the boundary to accommodate the client's generic call options. An operation with no supplied answer fails the test.

The SQL seed expects the fixture schema. My Library and journal articles are the defaults. Seed rows for additional Libraries before inserting their Items. Item-derived ids let callers insert batches of fixture works separately. Vitest resolves the types-only Obsidian import to the kit's runtime stand-in and supplies the kernel's build constants.

## Database status and fallback in Obsidian

Seed the Database file row's status from the current read service snapshot
because event subscribers can miss the initial transition. Reread the
active mode from the current connection after a change, degraded result, or
refresh failure. Show the resolved profile directory, data directory, and
Source ID together so the user can diagnose a live-update source mismatch.

Offer manual refresh for stale watcher data, including after system sleep
or on a network-mounted Zotero directory. Report a refresh failure even
when the old connection remains usable. Let the progress notice own this
feedback and remain visible within the Notifier's scope. Plugin unload
interrupts refresh quietly.

Suggest tags from the Annotation's own Library. Read them from the database
so newly saved tags appear after the next read sees them. On failure, warn
and return an empty list so the editor can open. Let interruption propagate
inside Effect. At the Promise bridge, an interrupted or stopped read
returns an empty list.
[Database command](../../packages/plugin-services/src/obsidian/database/actions.ts) · [Library tag suggestions](../../packages/plugin-services/src/obsidian/database/library-tag-names.ts)

Keep serialized Template Data descriptors browser-safe. The Node Item
Snapshot export owns its SHA-256 revision and reads the Item Query
seed synchronously in the worker. Reject missing Library or Item
selections and disallowed vault paths. Report redaction as explicit
unavailable values. A personal Library's public link reveals the
Zotero account name, so suppress it. Retain a group link derived
from its public group ID.
