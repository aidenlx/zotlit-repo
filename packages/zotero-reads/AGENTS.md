# @zotlit/zotero-reads

ZoteroReads: the asynchronous RPC between a ZotLit plugin's renderer and the Web Worker that owns the Zotero database ([ADR 0068](../../docs/adr/0068-the-zotero-database-runs-in-a-web-worker-behind-zoteroreads.md)). The ZotLit host composes it; the standalone ZotLit Reader has no Zotero connection and does not run this service. The term is defined in the Obsidian Plugin glossary (`apps/obsidian/GLOSSARY.md`).

## Layers

Each layer is one folder of `src/` and one runtime zone ([ADR 0117](../../docs/adr/0117-runtime-zones-are-checked-by-the-module-graph.md)): `contract/` and `worker/` are the Worker zone, `client/` the Obsidian zone (`zotlit.layers` in `package.json`), and `desktop/` the desktop zone. A new file goes in the folder of the runtime that loads it. A layer imports the layers below it: contract ← worker, contract ← client, and all three ← desktop. The runtime check (`pnpm run lint:runtime-zones`) holds the zones, and `oxlint.config.ts` keeps `contract/` and `client/` from importing `worker/`. Lint refuses Node built-in imports and the Node globals outside `desktop/`.

- `contract/` — the `ZoteroReads` RpcGroup (`rpc.ts`), its schemas and codecs, and the value types both sides share: Library Scope, the Query Job codec, the citation lookup answer, the `Changes` feed, the Item Snapshot (`snapshot/`). Worker zone: it loads in a Web Worker on each host.
- `worker/` — the handlers that answer the RPCs from a `ZoteroDatabase` (`handlers.ts`), the readers they use, the `Connection` they borrow (`connection.ts`), the in-process adapter, the Item Snapshot export (`snapshot/`, which takes its revision hash from the host), and `serveZoteroReads` (`serve.ts`) for a host's Worker entry. The worker modules are in the Worker zone, with no DOM, host module or Node: the host passes in its database opener, its file system, its read of the Chinese Segmenter from the Resource Pack, its Item Query adapter (`QueryJobRunner`) and the revision hash of the Item Snapshot.
- `client/` — the renderer side: the `ZoteroReads` service (`service.ts`), the Worker client that spawns and respawns the Worker (`worker-host.ts`), leases, events and view atoms. It loads on Obsidian Mobile: the Obsidian kit, and no Node or Electron.
- `desktop/` — the desktop host's database source: Read Mode, clones of `zotero.sqlite`, fingerprints, file watches and the refresh lane (`source.ts`, `read-source.ts`), the `node:sqlite` handle (`node-client.ts`), the sha256 revision hash of the Item Snapshot (`snapshot-revision.ts`), and the sweeps of read clones (`reap-temps.ts`). Only a desktop host imports it.
- `__fixtures__/` — test support for this package and its consumers: `in-process.ts` (in-process clients, openers), `reads.ts` (the service over a test transport), `citation-lookup.ts` (lookup answers), `reads-seed.ts` (the seed of the handler suites), `web-api.ts` (a seed served by the fake Zotero Web API, and the Web API source on the wasm memory driver).

A host writes its Worker entry with `serveZoteroReads`: it gives the `Connection` layer that opens its database, its revision hash for the Item Snapshot, and its platform. The desktop plugin's entry is `apps/obsidian/src/services/zotero-reads/worker.ts`; the app's Vite config bundles it as the embedded Worker.

The online library has its own Worker root, `serveZoteroReadsWeb` (`worker/serve-web.ts`), with the `ZoteroReadsWeb` RpcGroup and its initial message in `contract/web-worker-rpc.ts`. Its entry is `src/worker/zotero-reads-web-root.ts` of `@zotlit/obsidian`, which adds the Query Job runner; `main.js` carries the Worker code as text, and the Resource Pack gives only the wasm engine. `client/web-worker.ts` reads the wasm entry from the pack and starts the Worker. The plugin and its Worker are one build, so their protocol has no version.

The Query Job and its answer belong to the host's Item Query adapter. The contract carries them through `ItemQueryTypes` (`contract/item-query.ts`), which the host fills by declaration merging.

## The Web API source

`worker/web-api-source.ts` (`layerWebApiSource`) is the `Connection` over the Web Library Replica and the `WebLibrarySync` service behind the settings page. It runs the sync engine of `@zotlit/web-library` on one replica file, with a write connection for the sync and a read connection for the readers. The renderer (`LibrarySource` of `@zotlit/plugin-services`) drives the refreshes and the account consent; the Worker has no timer.

- **State.** The availability is one state machine, `worker/web-api-machine.ts`: `transition` is the only code that changes it, and `SyncStatus`, the read state and the change events are its projections. After a change to its events, regenerate `worker/web-api-machine.table.md` with `pnpm exec turbo run @zotlit/zotero-reads#generate:machine-table`.
- **Plan.** Each sync checks the key first and lets `plan` (`worker/replica-plan.ts`) choose a first build, an incremental sync, a rebuild, a wait for consent or a refusal.
- **Invariants.** A change here keeps each of these; the named suite holds it.
  - A failed sync keeps the last good replica readable and names the problem only in `SyncStatus` (`web-api-source.test.ts`, "keeps reads ready on the last good replica").
  - A rebuild for a new Zotero language downloads the whole account into the staging while readers read the old replica, and replaces it in one apply only when every library downloaded (`web-api-source.test.ts`, "while a language rebuild downloads"). A rebuild for another account empties the replica first, so that account's data is never readable while the new one downloads.
  - The apply is one transaction in time slices: readers read the committed replica until the commit, and past the dirty-page budget they wait in the read gate and then read the new replica (`web-api-source.test.ts`, "until the changed pages pass the budget"). The budget and slice sizes are `APPLY_SLICING`.
  - The commit runs only when no reader holds a borrow, and a waiting commit holds new borrows back only for the hold-back (`worker/read-gate.test.ts`).
  - The commit, the swap to a renewed read client and the `changed` event are one uninterruptible step, and a sync with no reader-visible change keeps the client and sends no event (`web-api-source.test.ts`, "keeps the client object and emits no change"). The apply result of each library says whether readers can see its change.
  - The replica takes at most two slots of the OPFS pool (the file and its journal): both connections keep temporary files in memory (`web-api-source.test.ts`, "with temporary files in memory").
  - The two connections rely on the file locks of `opfs-sahpool`. The engine pin proves them at test time in `@zotlit/drizzle-sqlite-wasm` ("the pinned engine"), and the open trusts the pin.
  - A `Backoff` or `Retry-After` deadline holds for every later request to the same Zotero address, also in the next sync (`web-api-source.test.ts`, "keeps the Backoff deadline").
  - The API key appears in no log, error, event or status (`web-api-source.test.ts`, "prints no API key").
  - A stop at any point leaves a replica that converges on the next start, with no account's data deleted and no other account downloaded without consent (`worker/web-api-crash.test.ts`). The memory storage in Node cannot leave a journal behind, so a stopped Worker's journal is proven only on real OPFS in a host.
- A borrow during the first build waits with no time limit; while the replica loads, `pendingIdentity` answers `SourceIdentity` without a borrow.
- The Web Worker root gives the item index `layerUnpinnedConnectionItemSource` (`worker/item-source.ts`), which holds no borrow between reads, so the index never blocks a commit.

## Tests

From this package directory, `pnpm exec vitest run src/<layer>/<file>.test.ts` runs one file. The suites run in Node over `node:sqlite`, and the handler suite of `worker/zotero-reads.test.ts` runs a second time over the Web API source, with an expectation for each source where a result differs; the client suites read the Obsidian kit through the Obsidian mock of `@zotlit/obsidian-kit/vitest`. The End-to-end Run proves the real Worker transport.
