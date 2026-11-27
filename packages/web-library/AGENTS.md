# @zotlit/web-library

The read-only sync engine of the Web Library Replica: it downloads the personal library and each group library that a Zotero API key reads from the Zotero Web API, and applies them to a replica made by `createReplica` of `@zotlit/db/replica`. This package holds the network and the order of a pass; the SQL lives in `@zotlit/db/replica`, and the Worker source of `@zotlit/zotero-reads` decides when to sync and which account the replica may hold.

The package is in the Worker zone (`zotlit.layer: "worker"`). The caller passes `fetch`; the package reads no global `fetch`. `src/__fixtures__/` is test support and may use Node.

## Where a change goes

- `src/download.ts` — the order of a sync: the key check (`verifyKey`), the group list (`listKeyLibraries`), and the pass of each library (`downloadReplica`), which writes only the staging tables, so readers can read during it. The apply is `applyDownloadSteps` of `@zotlit/db/replica`, re-exported here.
- `src/api-client.ts` — one request: headers, the shared pause, retries and the typed errors of `src/errors.ts`.
- The order of a pass and the retry steps follow the Zotero desktop client at commit 213b0d7d7 (`chrome/content/zotero/xpcom/sync/syncEngine.js`, `syncAPIClient.js`). Cite that source when you change one. Two rules are ZotLit's own: `Backoff` pauses on any answer (the desktop client reads it only on a success), and a burst of refusals takes one step of the wait.

## Invariants

A change keeps each of these; the named case of `src/download.test.ts` holds it.

- A library that the key no longer reads is removed in the apply by one rule for the personal library and the groups; the personal library keeps its row with version 0, so a key that reads it again downloads it in full ("reads only groups").
- A group list is trusted only when its number of entries equals its `Total-Results` header, which the Zotero dataserver sends for `format=versions` and counts after it drops the groups the key cannot see; any other answer fails the sync before a staged pass is reused or a removal is staged ("shorter than its Total-Results").
- A failed pass keeps the committed version and the readable data ("after a failed pass"), and an interrupted pass continues from the staging ("continues an interrupted first build"). Only a pass that the present sync confirmed is applied: each download starts by setting every complete pass back to downloading ("present sync confirmed").
- A change of the key's note permission compares the library in full, because the library version does not change with it ("note permission").
- A rebuild (`rebuild: true`) fetches every object again into the staging while the committed replica stays readable; the Worker source owns the decision to apply it.
- A staged pass is reused only when the present sync makes the same kind of pass: the same library list, note permission and rebuild flag; `reconcileStagedLibraries` is that one check ("another note permission", "rebuild staged").
- A rebuild's apply equals a fresh build row for row, also after later incremental syncs ("row for row", "after each step").
- Every request waits for the pauses that answers set: `Backoff` and a 503 `Retry-After` pause the Zotero address, a 429 pauses its key. A caller that passes the same `pauses` to each client keeps them across syncs ("pauses every request for Backoff"; the cross-sync cases are in `web-api-source.test.ts` of `@zotlit/zotero-reads`).
- The API key appears only in the `Zotero-API-Key` header ("keeps the API key out").
- Every request refuses a redirect (`redirect: "error"` in the client), so the key never goes to another address; the refusal is a `WebApiNetworkError` ("refuses a redirect").

## Tests

`src/download.test.ts` runs the engine against `FakeZoteroApi` on a local HTTP server and compares the readers' results with the parity replica of `@zotlit/db/replica/parity-pair`; rate-limit cases advance the `TestClock`. The harness (`src/__fixtures__/harness.ts`) checks the staging invariants of `@zotlit/db/replica/staging-invariants` after each step.

The fake API (`./fake-zotero-api` and its `server`, `scenario`, `harness` and `reader-view` entries) is also test support for the Worker source, the settings page and the End-to-end journey. It must answer as the real API does, including what a key may not read; `src/__fixtures__/fake-zotero-api.test.ts` holds it to the real records of the public group and to the documented behaviour, and each rule there cites its source.
