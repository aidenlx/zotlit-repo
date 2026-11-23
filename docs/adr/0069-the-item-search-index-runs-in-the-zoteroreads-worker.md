---
status: amended by ADR-0101
---

# The item search index runs in the ZoteroReads worker

> **Amended by [ADR 0101](0101-managed-binaries-ship-in-the-resource-pack.md).** The Managed Binary parts are revised: the Chinese Segmenter and the Pandoc Engine ship in the Resource Pack, a third plugin installed from Obsidian's community plugins. ZotLit downloads no binary, asks for no consent and keeps no device-wide OPFS store; the worker reads and verifies the Chinese Segmenter from the pack file. The index, ranking and worker decisions stand.

Amends [ADR 0068](0068-the-zotero-database-runs-in-a-web-worker-behind-zoteroreads.md): the item search index joins the database in the Web Worker, and two operations leave the ZoteroReads contract.

The search behind the Citation Suggester, the quick switcher, and every Item picker is answered by one ZoteroReads operation, `SearchItems`. The renderer sends the local ids of the Libraries in Library Scope, the query, and a limit, and receives ranked Items with title highlight ranges. The worker owns the **Item Index**: it builds the MiniSearch index from its own connection, keeps it fresh from its own change feed, serves the last complete index while a rebuild runs, and hydrates the hits before it answers. Chinese word segmentation runs in the worker through a ZotLit-managed **Chinese Segmenter**, the pinned `jieba-wasm` binary. _(Revised by ADR 0101: it ships in the Resource Pack.)_

## Why

After ADR 0068 the worker streamed `IndexItems` slices to the renderer, and the renderer built the index and ran every search on the main thread. The frame gap during a build was at the idle floor, but the index memory, the build CPU, and every keystroke's search stayed on the thread that paints the editor; at 100,000 items the index lived in the renderer heap for the session. Renderer CPU profiles on a sibling branch tied long frame gaps during large exports to garbage collection, with a live lookup index among the retained heap; a yield cannot split a collector pause, so the retained memory has to leave the renderer. Chinese titles depended on a function borrowed at runtime from the third-party `cm-chs-patch` plugin, which cannot cross to a worker.

Four interface shapes were compared on depth, locality, and seam placement before this one was chosen: one lean-hit operation with renderer-side hydration; explicit index handles with build-progress streams; one hydrated operation; and the same operation with the index as a worker-side service. The last two combined are this decision. The lean variant costs a second round trip per keystroke; the handle variant adds four operations whose extra entry points have no caller today.

## Decision

- **One operation.** `SearchItems` takes `libraryIDs` in canonical order, `query`, and `limit`, and answers hydrated `Item` rows with highlight ranges in rank order. No score crosses the wire. No Snapshot field: the index and the hydration read the connection the index was built on. `IndexItems` and `IndexSignature` leave the contract; the renderer index was their only caller.
- **The index is an Effect-native service in `@zotlit/item-lookup`.** The package adopts Effect as its core and holds the Item Index lifecycle behind an item-source port with a `pinned` member for one build and a generation stream for source swaps; the worker's `Connection` adapter and an in-memory test adapter are its two adapters. The handler layer builds the service beside `Connection`, so both ZoteroReads adapters compose it the same way. The package imports neither Obsidian nor Effect RPC.
- **MiniSearch ranks; one rule stays on top.** Citation key, Zotero key, and year are indexed fields; the query runs with AND, prefix, fuzzy, and field boosts. Items whose citation key starts with the query come first, shortest first; ties fall to newest-first, Library rank, item id. The hand-written candidate intersection, the per-token scan over every Item, the tiers, the recency multiplier, and the exact-year bonus are removed. Query fine-tuning is out of scope; `boostDocument` is the hook for a recency boost later.
- **Index identity is the library list and the connection it was built on.** A `changed` event re-checks every held index: a swapped connection forces a rebuild, an equal per-Library signature vector skips it, a moved one rebuilds. `degraded` drops every index. The list the latest search asked for stays held across changes; any other list no caller asked for since the last change is evicted at that change. Zotero reassigns local Library ids across database files, so the list alone is not an identity.
- **Stale-while-revalidate stays, inside the worker.** The first search for a list waits for its build; later searches answer from the held index while a rebuild runs. Rebuilds are single-flight with one trailing rerun. The build borrows the connection for its whole life and runs `Effect.yieldNow` after each slice, so a query or the liveness ping interleaves.
- **Cancellation is a fiber interrupt.** The renderer facade runs the searches of each search surface (a picker, the Citation Suggester) in one `FiberHandle`; a new keystroke interrupts the one before it on that surface, and one-shot searches run beside them. The RPC interrupt stops the search in the worker. An interrupted waiter leaves a running build for the next caller.
- **The renderer keeps a thin facade.** `ItemLookup.search(query, { limit })` resolves Library Scope to ids, calls `SearchItems`, attaches Library labels from the scope it asked with, prewarms on ready and on scope change, and answers empty while the database is unavailable.
- **Locale is configuration.** The UI locale reaches the worker in `ReadsConfig` with the spawn and through `Configure`, and feeds the creator-name language lookup.
- **The Chinese Segmenter is a Managed Binary.** _(Revised by ADR 0101.)_ It is a Pack Entry of the Resource Pack, pinned to the `jieba-wasm` version and SHA-256 that the pack build checks. The worker reads and verifies the entry itself from the pack file once `Configure` names the installed pack, and uses `cut_for_search` for indexing and queries. A change of the installed pack reaches the worker through `Configure` and through `CheckChineseSegmenter`, the renderer's request for the Segmenter's status, which reads the entry again; a Segmenter that starts or stops rebuilds the tokenizer and every held index; a pack update with other Segmenter bytes takes effect after a restart, because `jieba-wasm` holds one instance per realm. Without the binary, CJK runs segment through `Intl.Segmenter` at word granularity. ZotLit no longer reads `cm-chs-patch`.

## Considered Options

- **Keep the index in the renderer and stream slices.** The frame gap was already at the floor, but memory, build CPU, and search stayed on the main thread. **Rejected.**
- **Lean hits and renderer hydration.** One more round trip per keystroke for no caller that wants lean hits. **Rejected.**
- **Explicit index handles (`OpenIndex`, `Search`, `Reindex`, progress events).** Flexibility with no present caller; seven pickers would share one handle through the facade anyway. **Rejected.**
- **Keep the hand-written ranking layer and only restructure its scan.** Identical results, but 230 lines kept for scoring behaviour that is out of scope to tune, and the one-letter worst case fixed by a second index structure beside MiniSearch's own. **Rejected.**
- **Keep borrowing `cm-chs-patch`'s `cut`.** A function cannot cross to the worker, and search quality should not depend on another plugin. **Rejected.**
- **A timer-based yield between build slices.** `setTimeout(0)` lets requests through but the nested-timer clamp adds 38–40 % build time; `Effect.yieldNow` resumes on `setImmediate` and costs nothing. **Rejected.**
- **Ship `jieba-wasm` in the plugin bundle.** About 3.8 MB for every user. **Rejected** in favour of the Managed Binary, which ships in the Resource Pack (ADR 0101).

## Consequences

- The worker holds state that is not a connection. A rebuild slice can delay a concurrent read by up to one slice; the slice size and yield strategy follow the measurement recorded below.
- Ranking changes: citation-key prefix hits still come first; beyond that MiniSearch's score orders results and ties fall newest-first. The recency multiplier and the exact-year bonus are gone.
- Users of `cm-chs-patch` see their Chinese titles tokenized by `Intl.Segmenter` until they install ZotLit Resource Pack from Obsidian's community plugins (ADR 0101).
- Index build logs move from the plugin logger to the worker's console sink (see [#1349](https://github.com/aidenlx/zotlit/issues/1349)).

## Measurements

Measured in Obsidian 1.14.4 on a synthetic library with Zotero's indexes, production engine and reads, plain `postMessage` probes (idle floor 16.7–17.7 ms; details in the spec [#1356](https://github.com/aidenlx/zotlit/issues/1356) measurement ticket):

| Metric                    | 10,000 items, renderer index          | 10,000 items, worker index                            | 100,000 items, renderer index        | 100,000 items, worker index                          |
| ------------------------- | ------------------------------------- | ----------------------------------------------------- | ------------------------------------ | ---------------------------------------------------- |
| Index build               | 0.33 s, max gap 16.8 ms, 0 long tasks | 0.37 s (yield per 500), max gap 16.8 ms, 0 long tasks | 3.8 s, max gap 17.7 ms, 0 long tasks | 4.5 s (yield per 500), max gap 17.7 ms, 0 long tasks |
| Typical query, end to end | 4–12 ms                               | 4–12 ms                                               | 7–16 ms                              | 7–20 ms                                              |
| One-letter query          | 12 ms                                 | 12 ms                                                 | 180 ms, one 174 ms long task         | 170 ms, renderer free                                |
| Query during a rebuild    | 11 ms median                          | 6–17 ms median by slice size                          | 18 ms median, 71 ms max              | 13 ms median, 28 ms p95 (yield per 500)              |
| First keystroke, cold     | 0.4 s                                 | 0.4 s                                                 | 4.0–4.6 s                            | 3.8–4.7 s                                            |
| Index heap                | +11 MB renderer                       | +10 MB worker, released on drop                       | +104 MB renderer                     | +97 MB worker, released on drop                      |

The build frame gap was already at the idle floor before this change, because the renderer slices cost 8–13 ms each. The gains are the index heap leaving the renderer, the worst-case query leaving the main thread, and one owner for the lifecycle. SQL hydration of 50 hits (about 4.5 ms, one statement per key) dominates a typical query in both variants.

The shipped worker adapter, measured in Obsidian 1.14.4 by the End-to-end Run (`packages/e2e`, test "rebuilds the worker's Item Index off the renderer", which logs these figures) on the Fixture plus 10,000 synthetic journal articles (title, journal, one to three authors; this corpus makes a 21 MB index in Node), development build:

| Metric                                                             | Shipped plugin, 10,000 items, worker index                                                                                   |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Index rebuild after a Freshness Signal                             | 1.6 s from the signal to the first answer with the new Items, refresh included; max frame gap 18 ms, 0 long tasks            |
| Renderer heap after the rebuild                                    | +0.3–0.5 MB after a forced garbage collection                                                                                |
| Typical query, end to end (median / p95, 21 runs, 37–50 hits each) | 4–10 ms / 4–10 ms (an author 5.9 / 6.5, one title word 7.3 / 8.3, two title words 9.7 / 10.4, a unique title word 3.8 / 4.2) |
| One-letter query (`k`)                                             | 8.1 ms median, 13.9 ms p95                                                                                                   |
| Query during a rebuild                                             | 2.8 ms median, 4.6 ms max over 82 polls; every poll answered from the held index                                             |

Inside a real `RpcServer` worker, `Effect.yieldNow` after each slice of 250–500 items gives a 5.5 ms median wait for a concurrent request and adds no build time. A worker-drained `Stream.mapEffect` without it does not yield; `scheduler.yield()` and no yield make a query wait for the whole build; `setTimeout(0)` works but adds 38–40 % build time. A single read of 100,000 ids overflows the call stack in the query builder, so the build reads in slices.

## Ranking details and title highlight ranges

The engine holds a lean record with the Indexed Key and title. The service
hydrates hits from the pinned source. An unresolved key drops out. A bare
Zotero key is library-local, so an exact key search returns all matches across
the requested libraries. A key query without an exact match falls through to
text search.

The engine adds each complete citation key alongside its segmented words.
This lets a complete query prefix match across a segmentation boundary. Text
search combines that prefix branch with a branch that requires each term to
match an indexed field. Terms of up to three characters use exact or prefix
matching. Longer terms can match fuzzily. The ranked path yields between
lookup and ranking so an interrupted search can stop before ranking.

Build slices arrive one library at a time. The engine sorts the full corpus
after reading them. Ties in key and scored searches use modification time,
the requested library order, and item id. An unknown library ranks after the
listed ones. An empty query puts cited Indexed Keys first, then sorts by
Last Activity and Indexed Key. A request Use is in epoch milliseconds and
can only raise activity. The engine brings those Items into the candidates
before sorting.

The highlight comes from MiniSearch's matched indexed terms, including prefix
or fuzzy expansion. The engine folds diacritics and handles Polish ł before
matching. It walks original code points as whole units and maps both match
endpoints back to UTF-16 offsets for Obsidian. The map includes the trailing
end offset. The creator formatter follows the pinned citeproc name character
class. [citeproc implementation](https://github.com/zotero/zotero/blob/9.0.3/chrome/content/zotero/xpcom/citeproc.js#L705)
[CJK highlight follow-up](https://github.com/aidenlx/zotlit-repo/issues/56)

## Index and Segmenter lifecycle

A pinned source supplies bounded batches, signatures, and a lookup for
hydration. Empty batches are valid. The change stream reports new events
after subscription. A changed generation can mark a source swap. An
equal-signature recheck moves the existing index to the fresh source. An
unequal recheck builds a new index. A failed or interrupted build releases
any source it did not publish.

Searches hold a binding through hydration so the returned rows and ranges
describe one state. A retired binding closes after its last reader. If the
index disappears between lookup and acquisition, the search waits for the
next index. A list with a waiting search cannot be evicted. The most recent
list also stays held. The lane's final rerun check and release share a
synchronous step, and a waiter registers its release as it increments the
count. On shutdown, lanes finish before the finalizer releases the held
sources.

The first Segmenter resolves before search becomes available. Configuration
calls serialize in arrival order. A locale change and a Segmenter change
from the same call schedule one rebuild per held list. The call returns
after scheduling. Each build uses the same splitter for indexing and
queries. A failed binary read or initialization falls back to
`Intl.Segmenter`. The next request can try that binary again. Jieba receives
whole CJK runs so it can return compound words and their parts. The web
binding reuses the first live instance in a realm. Uninstall switches back
to Intl without unloading that instance. [Binary replacement follow-up](https://github.com/aidenlx/zotlit-repo/issues/57)

## Test seams

The in-memory source provides both the indexed row and its hydration row from
one fixture. Typed fixture fields require the corresponding Zotero item type
and drive the derived base fields and Venue. The source can simulate a
disappearing hydrated row without changing signatures. Its one-shot
hydration gate permits later reads and its release callback runs in the
closing fiber. Tests use these seams to interleave builds, configuration,
and searches. The canonical library order in the ranking test differs from
the source order. The interruption test starts its search fiber inline so it
reaches a real scheduling boundary before the interrupt.

The benchmark runs separately with
`pnpm --filter @zotlit/item-lookup bench` because it builds a 100,000-Item
index and checks a wall-clock bound.

## Worker source scheduling

The pinned Item Index source uses one connection for signatures, indexing and hit hydration. It rechecks on changed or degraded events. The lifecycle seed is a current-state event and does not trigger a second initial build.

A worker SQLite statement is synchronous. A search can wait behind the current statement. The source yields between signature ranges of 10,000 item ids. On the 100,000-Item Stress Build, a range took a few milliseconds, and a whole-Library signature took 60–96 ms. Signature scans use one statement per range to preserve margin under the 100 ms search budget. Each range obeys the fixed statement count for a ZoteroReads slice.

The whole-Library batch selector shares the bounded scan with indexing. It reads spans of 500 ids, sorts each run, and merges at most 500 rows per step to keep newest-first order. Its caller keeps the client borrowed through the scan. The merge runs on the Item Query scheduler so its yields return to the browser's MessageChannel queue.

The search-handler tests distinguish a signature check from a rebuild by counting their statements. A rename that preserves both modification times leaves the signature equal, while a new local user key distinguishes another database even with the same ids and signatures. The equal-signature case reuses the built index with a new hydration connection and keeps the list active between refreshes. The Configure tests can replace the rebind with a no-op to isolate the locale and Segmenter. The Segmenter fixture searches for a substring that jieba emits from a larger word but Intl keeps whole.

The Chinese Segmenter pin tracks the installed `jieba-wasm` web build. Fetch its bare WASM file from the versioned npm CDN path and compare its SHA-256 with the installed package bytes. Keep the glue and binary from the same package build. The Vite transform prevents library mode from inlining the default WASM URL because the worker uses `initSync` with the installed Managed Binary. A changed upstream loader path fails the transform so the asset cannot enter the worker silently.

The signature sums a contribution for each indexed Item. Weight child activity by the parent Item ID so moving a child between Items changes the signature even when the Library's total activity is stable. Apply a modulus to bound each activity term. Sum disjoint Item ID ranges to get the Library signature. Use the Library index for the whole-Library reference read and a rowid range for each worker slice, so sparse Libraries do not make each slice scan the Library index. The 2026-11-23 amendment states which modification times the contribution reads and the accepted same-second limit. [Same-second search refresh](https://github.com/aidenlx/zotlit-repo/issues/146)

The Chinese Segmenter uses the pinned web build of `jieba-wasm`. The
renderer compiles it during install to verify the binary, with no instance
or memory to release. The ZoteroReads worker instantiates it from the device
cache. Both contexts share the renderer's origin and OPFS directory. Read
OPFS through its Promise API at the worker boundary.
[Renderer segmenter service](../../packages/plugin-services/src/obsidian/chinese-segmenter/service.ts) · [Worker binary reader](../../packages/plugin-services/src/core/chinese-segmenter/opfs-reader.ts)

### Index rebuild responsiveness proof

Use a Stress Build isolated from the Development Vault. Place
searchable Stress Items near both ends of the corpus. An unchanged
push leaves downstream indexes alone. A source change updates
the signature and rebuilds the Item Index. The Fixture has no
running Zotero, so the test controls source writes. Warm searches
still cross the interactive worker boundary and hydrate from
SQLite. Yield after a held response so refresh and search can
progress, and sample one search per pass during the rebuild.

Use the renderer slice limits from the Query measurement. Check
search response and worker timer gaps separately. Earlier native
edits measured 39–57 ms searches and 113–128 ms worker timer gaps.

[Index responsiveness cases](../../packages/e2e/src/citation-index.e2e.ts)

Observe frame gaps and long tasks in the active renderer. Measure its
heap after garbage collection, excluding the worker heap. The refresh
fixture inserts deterministic synthetic My Library journal articles in a
single transaction. Their titles have a shared marker and distinct final
words. Derive keys and names from the new Item IDs so successive
inserts stay distinct. Signal freshness through the Companion's update
path. On disposal, delete the inserted rows.
[Measurement helpers](../../packages/e2e/src/e2e-run-note-helpers.ts)

Require a populated index before measuring. Sample at 10 ms while the
worker builds to observe the held answer and its replacement. Check
renderer frame gaps and tasks concurrently, and bound retained index heap
in the renderer. Measure queries that hydrate results. Share one Snapshot
for a large classification while bounding request encoding and replies.
Run the Citation Suggester after these measurements because formatting
can start Pandoc and add renderer work. Space keystrokes beyond
Obsidian's suggester delay to send a search for each input. Use busy state
to distinguish old results from the final query.

Resolve canonical Library IDs for the current request, or accept its
explicit override. Read the Library labels from the requested scope so
a rename does not require index rebuild. Prewarm after startup and
scope changes. An unresolved scope or unavailable database gives an
empty answer. A Search Session interrupts its previous request through
the Worker on the next keystroke. One-shot searches run alongside it.
Chinese queries request the Segmenter without waiting for its status
or notice. Concurrent keystrokes share the pack read. The focused
fixture can hold that read while successive searches interrupt.

A verified digest added by the renderer can confirm the same entry
the Worker already loaded, without rebuilding solely to add the hash.
When a requested binary fails to load, clear the requested identity
so the same location can be retried. Apply a resolved switch before
requesting another. Test configuration and source changes together so
the configuration rebuild can publish first.
[Segmenter switch](../../packages/item-lookup/src/segmenter-switch.ts)

## Amendment (2026-11-23): the signature reads both modification times

Each Item contribution also sums `clientDateModified` in seconds, from the same `items` row. Zotero saves with `skipDateModifiedUpdate` keep `dateModified` and still write `clientDateModified`: Better BibTeX citation-key fills, sync downloads with an unchanged remote date, and clean-up scripts. A refresh after those edits rebuilds the Item Index. On 100,000 Items, the median signature scan went from 63.0 ms to 66.3 ms, and search during the refresh stayed under the 100 ms budget.

Accepted limit: both columns have second precision. The old search terms stay until the Item's next save or the next session in two cases: two saves of one Item inside one second with a refresh between them, and a save with `skipAll`, which writes neither column. The first case needs a refresh to land inside that second.

Rejected: a signature over the indexed field values. It adds field reads for every Item to each refresh scan.

The maintainer accepted the limit on 2026-11-23. The change is landing from branch `fix/item-search-56-57-146-177`. [Issue 146](https://github.com/aidenlx/zotlit-repo/issues/146)
