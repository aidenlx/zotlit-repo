# @zotlit/zotero-reads

ZoteroReads: the asynchronous RPC between a ZotLit plugin's renderer and the Web Worker that owns the Zotero database ([ADR 0068](../../docs/adr/0068-the-zotero-database-runs-in-a-web-worker-behind-zoteroreads.md)). The ZotLit host composes it; the standalone ZotLit Reader has no Zotero connection and does not run this service. The term is defined in the Obsidian Plugin glossary (`apps/obsidian/GLOSSARY.md`).

## Layers

Each layer is one folder of `src/` and one runtime zone ([ADR 0117](../../docs/adr/0117-runtime-zones-are-checked-by-the-module-graph.md)): `contract/` and `worker/` are the Worker zone, `client/` the Obsidian zone (`zotlit.layers` in `package.json`), and `desktop/` the desktop zone. A new file goes in the folder of the runtime that loads it. A layer imports the layers below it: contract ← worker, contract ← client, and all three ← desktop. The runtime check (`pnpm run lint:runtime-zones`) holds the zones, and `oxlint.config.ts` keeps `contract/` and `client/` from importing `worker/`. Lint refuses Node built-in imports and the Node globals outside `desktop/`.

- `contract/` — the `ZoteroReads` RpcGroup (`rpc.ts`), its schemas and codecs, and the value types both sides share: Library Scope, the Query Job codec, the citation lookup answer, the `Changes` feed, the Item Snapshot (`snapshot/`). Worker zone: it loads in a Web Worker on each host.
- `worker/` — the handlers that answer the RPCs from a `ZoteroDatabase` (`handlers.ts`), the readers they use, the `Connection` they borrow (`connection.ts`), the in-process adapter, the Item Snapshot export (`snapshot/`, which takes its revision hash from the host), and `serveZoteroReads` (`serve.ts`) for a host's Worker entry. The worker modules are in the Worker zone, with no DOM, host module or Node: the host passes in its database opener, its file system, its read of the Chinese Segmenter from the Resource Pack, its Item Query adapter (`QueryJobRunner`) and the revision hash of the Item Snapshot.
- `client/` — the renderer side: the `ZoteroReads` service (`service.ts`), the Worker client that spawns and respawns the Worker (`worker-host.ts`), leases, events and view atoms. It loads on Obsidian Mobile: the Obsidian kit, and no Node or Electron.
- `desktop/` — the desktop host's database source: Read Mode, clones of `zotero.sqlite`, fingerprints, file watches and the refresh lane (`source.ts`, `read-source.ts`), the `node:sqlite` handle (`node-client.ts`), the sha256 revision hash of the Item Snapshot (`snapshot-revision.ts`), and the sweeps of read clones (`reap-temps.ts`). Only a desktop host imports it.
- `__fixtures__/` — test support over `:memory:` databases for this package and its consumers: `in-process.ts` (in-process clients, openers), `reads.ts` (the service over a test transport), `citation-lookup.ts` (lookup answers).

A host writes its Worker entry with `serveZoteroReads`: it gives the `Connection` layer that opens its database, its revision hash for the Item Snapshot, and its platform. The desktop plugin's entry is `apps/obsidian/src/services/zotero-reads/worker.ts`; the app's Vite config bundles it as the embedded Worker.

The Query Job and its answer belong to the host's Item Query adapter. The contract carries them through `ItemQueryTypes` (`contract/item-query.ts`), which the host fills by declaration merging.

## Tests

From this package directory, `pnpm exec vitest run src/<layer>/<file>.test.ts` runs one file. The suites run in Node over `node:sqlite`; the client suites read the Obsidian kit through the Obsidian mock of `@zotlit/obsidian-kit/vitest`. The End-to-end Run proves the real Worker transport.
