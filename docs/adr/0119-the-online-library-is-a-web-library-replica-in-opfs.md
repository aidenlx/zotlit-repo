---
status: accepted
---

# The online library is a Web Library Replica in OPFS

## Context

ZotLit read only the Zotero database file of the Zotero app on the same computer, through a Node Worker and a Node SQLite client ([ADR 0068](0068-the-zotero-database-runs-in-a-web-worker-behind-zoteroreads.md)). A device with no Zotero, and each Obsidian Mobile device, had no library. Issue #292 planned one ZotLit for desktop and Mobile, and spec #294 built a second Library Source, the Web API Source ("Zotero online library"), and proved it on desktop Obsidian.

The fixed constraints were: Obsidian gives no cross-origin isolation, so SQLite's plain `opfs` storage is not available; Mobile has no Node; the desktop `main.js` had about 10 KB left in its budget; and the readers, the Item Query and the Citation Index already read the Zotero database layout through ZoteroReads.

## Decision

- **A replica in the Zotero layout.** The Web API Source builds a **Web Library Replica**: a SQLite database with the tables and views of the Zotero database that the readers use, filled from the Zotero Web API v3. The same readers and the same ZoteroReads RPC read it. Item IDs are local; an item keeps its Zotero key, and remote identity is library type, library ID and key. The vocabulary rows come from the vendored Zotero schema.
- **One Web Worker, one storage, on desktop and Mobile.** The replica lives in OPFS through `@sqlite.org/sqlite-wasm` with the `opfs-sahpool` VFS, which needs no cross-origin isolation. `opfs-sahpool` holds its files exclusively, so one Web Worker owns the replica, with two connections to its one file: the readers use the read connection, and only the sync engine writes, on the write connection. The file locks of `opfs-sahpool` (sqlite-wasm 3.54.1-build1 and later) arbitrate between them. Desktop uses this stack too, so the desktop proof is the proof of the Mobile stack. The Drizzle driver is its own package (`@zotlit/drizzle-sqlite-wasm`) with no knowledge of Zotero, ZotLit or Obsidian.
- **Read-only toward Zotero.** The sync engine (`@zotlit/web-library`) only reads the API. It follows the Zotero desktop client's sync order and rate rules. One write transaction applies the rows, the deletions and the library version of a sync, in short slices that return to the event loop, while the read connection serves the last committed state; the replica is never between two versions. Each Zotero-side action and each feature that needs an attachment file has a not-available state under this source.
- **Where the bytes ship.** The Worker text and the Temporal polyfill piece ship inside `main.js`, raw-deflated and base64-encoded, decoded only when the Web API Source starts. The sqlite wasm ships in the Resource Pack as the Pack Entry `sqlite-engine`; the plugin refuses an entry whose version differs from its bundled glue.
- **The key by secret name only.** The API key lives in Obsidian's secret storage. ZotLit keeps only the name of the secret, on the device, and the key is a redacted value in the configuration, the logs and the diagnostics.
- **Consent bound to the account.** The Library Source is a choice of the device. The first accepted key sets the Replica Consent. A key of another account leaves the replica untouched (`account-changed`) until the user selects "Replace data". "Remove online library data" deletes the replica and the consent, and keeps the secret.
- **One availability state machine.** The Worker keeps the availability of the source in one state machine (`packages/zotero-reads/src/worker/web-api-machine.ts`): `building`, `serving` or `unavailable`, with the outcome of the last sync (`ok`, `awaiting-consent`, `problem`) and the activity (`idle`, `syncing`). The settings status, the read state and the change events are its projections. A failed sync keeps the last good replica. A language rebuild for the same account downloads into staging and replaces the data in one apply, so the last good data stays readable until the commit; an account change still empties the replica first. A library that the key no longer reads is removed by one rule for the personal library and for groups, and the personal library keeps its row.

### Known differences from the Zotero File Source

| Area                         | Web API Source                                                                                                                                                                          |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Item IDs, `DatabaseIdentity` | Local to the replica; the replica has its own identity                                                                                                                                  |
| `Libraries.clientVersion`    | 0                                                                                                                                                                                       |
| Attachment files             | None: excerpt and annotation images, the PDF annotation editor, attachment open and import, note import images, vault PDF matching and query file probes show their not-available state |
| Zotero-side actions          | Refused with "This needs Zotero on this computer as the library source"; "Show in Zotero library" still opens a `zotero://` link                                                        |
| Full text, saved searches    | Not stored                                                                                                                                                                              |
| Citation keys                | The native Zotero `citationKey` field only                                                                                                                                              |
| Free-text dates              | Parsed in the "Zotero language" setting; a change rebuilds the replica                                                                                                                  |

## Considered options

- **The Zotero Local API only.** It needs Zotero running on the same computer, which is the gap this source closes.
- **Node SQLite for the replica on desktop (#320).** A plain file and a faster apply, but desktop would no longer prove the Mobile path, and two drivers and two storage places need tests and a migration.
- **A hosted proxy (#307).** It would remove the browser limits on requests, but the user's key and data pass through a server ZotLit runs. The metadata API permits each Obsidian origin, so the metadata needs no proxy; #307 keeps the decision for attachment files.
- **Cross-origin-isolated OPFS (`opfs` VFS, `sqlocal`).** It needs `SharedArrayBuffer` and cross-origin isolation, which Obsidian does not give.

## Consequences

- Budgets in force, set by the maintainer after the measurements of #306: desktop `main.js` 5,520,000 B (#306 reports 5,426,269 B after its change), ZotLit Reader `main.js` 1,700,000 B, Resource Pack 26,200,000 B (measured 26,042,489 B, the wasm).
- Measured start-up cost of the compressed texts (#306): desktop `daily` about +1 ms on 20 ms and `update` within the spread of the runs; Android plugin load and whole start within the spread; Android app memory about +3.5 MB on 128 MB.
- A first build of 50,000 items keeps the Worker busy for about 9 s in slices of at most about 28 ms; the pool uses 2 of its 6 slots (#308).
- "Remove online library data" deletes the pool directory when no Worker runs. With a running Worker, the Worker removes the replica file and creates an empty replica in its place: it holds no item, no synced library and no Zotero account, only the layout's own user library and a new local key.
- Each vault gets its own pool directory (`/zotlit/<app id>`) in the one OPFS of the Obsidian origin.
- A development build can send the requests to another address (a fake Zotero API in the End-to-end Run); a release `main.js` refuses that override, which the bundle check proves.
- A library version that goes down on the server is a known limit: the sync reads it as "no change". Only a restore of a deleted account by Zotero support causes it; "Remove online library data" and a new sync repair it.
