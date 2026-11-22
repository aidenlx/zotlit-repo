# Held Reads are realized on TanStack Query Core

Amends [ADR 0054](0054-held-reads-serve-the-old-answer-until-a-fresh-read-replaces-it.md). Amended by [ADR 0072](0072-the-citation-index-reads-in-a-dedicated-worker.md).

The annotation repository also runs its writes as mutations on this client; [ADR 0064](../../apps/obsidian/docs/adr/0064-surfaces-draw-pending-proposals-from-query-core-mutation-variables.md) draws their variables as Pending Proposals and pins Query Core's focus.

ADR 0054 introduced Held Reads on a hand-rolled store in the plugin. The annotation repository (aidenlx/zotlit#824) needs a second engine with the same serve-old-value rules plus a mutation cache, abort signals, and prefix invalidation, which the store lacks. Rather than grow the store into a second query library, we decided that Held Reads are realized on **`@tanstack/query-core`**, and the hand-rolled store is deleted. The Held Read stays the domain concept and the term; a Held Read is now a projection of a query's state, built by one plugin-wide query-client service that every owner receives through the container.

## Rules that differ from ADR 0054

- **A failed replacement re-arms after a cooldown.** ADR 0054 kept a failed value frozen until an unrelated invalidation. Query Core marks an errored query invalidated, so the next ask fetches again. To keep a persistent failure from re-running a read on every redraw, an ask within a short cooldown after the error serves the held value without a fetch. The rule is the same for a failed first read, which stays pending during the cooldown. An explicit invalidation ends that cooldown, because the owner is saying the inputs moved: the next ask fetches at once.
- **A superseded read still cannot publish, by cancellation.** Query Core commits an in-flight result and clears the invalidated flag, so an invalidation that lands mid-read would be lost. An owner cancels the in-flight read with revert before it invalidates. Every reader of that read asks again — the one that started it as much as the ones that joined it, because a revert answers the reader that started it with the value it reverted to, which the stale mark tells apart from a committed one.
- **Retention is time-based, not count-based.** There is no least-recently-used bound. Document Citation Text is retained while its document is open in a workspace leaf, pinned by its owner, and expires five minutes after that otherwise; text keys are vault paths, removed when the file is deleted. Citation Lookup view answers expire five minutes after their last observer leaves ([ADR 0072](0072-the-citation-index-reads-in-a-dedicated-worker.md)). Bibliography and citation renders expire after the default garbage-collection time because their keys change with every edit to the cited set.

## Consequences

- One `QueryClient` for the plugin, registered before every consumer, with `staleTime: Infinity`, `retry: false`, `networkMode: "always"`, and no focus or online tracking. Owners namespace their keys and set per-prefix defaults such as retention and semantic equality.
- The `changed`, `settled`, and `invalidated` contract from ADR 0054 stays, and all owners emit `settled` with the resulting Held Read or `null`. An owner emits `changed` and `invalidated` at its own invalidation sites and derives `changed` and `settled` from the query cache's success and error events filtered by its prefix.
- A Held Read is an immutable snapshot. A consumer that awaits `settled` asks again for the next snapshot instead of watching a status flip in place.
- Semantic equality is expressed as structural sharing. Render results use the default deep comparison, so an equal re-render keeps its identity and emits only `settled`.
- Surfaces do not hold query observers. An owner pins a query by observing it for as long as what the query serves is open: Citation Text pins each open document, and the Citation Lookup observes each view's request.

Start a bibliography refresh on the render layer's Scope before peeking at the held value. Return the held answer immediately when it exists. The layer keeps the shared refresh alive when a caller stops waiting. Ignore the initial state emissions when subscribing to the Profile and engine, since acquisition is not a change.

Include the complete resolved style, Item content, and ordered citations in a render key. Reusing IDs alone can let cancelled work answer for newer inputs under those IDs. Query Core's stable hash ignores object property order and preserves array order. [Bibliography render cache](../../packages/citations/src/desktop/pandoc/render-cache-layer.ts)

Publish the global bibliography invalidation revision in one atom for Template Document previews to share. [Bibliography atoms](../../packages/citations/src/obsidian/pandoc/atoms.ts)

## Shared read and settlement behavior

Project a key as one immutable snapshot with its last committed value,
current status, and settlement Promise. An editor can peek synchronously
after the first commit. When a write already knows the new value, it can
update an existing value without creating a cache entry for a previously
unread key. Keep local mutations running while the window is hidden. Local
reads never wait on network state.

Join the same in-flight read for the same key. An interrupted caller stops
waiting while the shared read continues. A display read can keep its old
value after replacement failure. An ask can reuse the held value during a
failure cooldown and otherwise reports no replacement on failure. A
composed dependency read propagates the original failure, even during
cooldown, so the parent does not commit fresh output calculated from stale
input. Stamp both ends of the cooldown using the layer's Clock, including a
test clock starting at zero. Query Core's error timestamp uses wall time.

Retry once after non-silent invalidation cancellation, for the initiating
reader and all joiners. A stale flag distinguishes a reverted value from a
new commit. Cancelled work cannot retry after disposal or removal, even if
a later query reuses that key. A fresh dependency read reports AbortError
when no result remains because of release or cancellation.

Capture the failure timestamp and Held Read snapshot in the synchronous
cache event before notifying inline watchers and publishing the Stream
event. Report every success or failure settlement. Structural sharing
keeps an equal value's identity, so it settles without a changed event.
Use the layer Clock in consumer fixtures. Effect tests let their Scope own
the runtime. Plain callers dispose it through the fixture handle.
[Query Clients](../../packages/plugin-services/src/core/query-client/service.ts)
