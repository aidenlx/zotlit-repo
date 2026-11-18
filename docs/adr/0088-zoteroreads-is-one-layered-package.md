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
