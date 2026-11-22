---
status: amended by ADR-0069, ADR-0072, and ADR-0073
---

# The Zotero database runs in a Web Worker behind ZoteroReads

> **Amended by [ADR 0069](0069-the-item-search-index-runs-in-the-zoteroreads-worker.md).** The item search index runs in the worker behind one `SearchItems` operation; `IndexItems` and `IndexSignature` leave the contract.

> **Amended by [ADR 0072](0072-the-citation-index-reads-in-a-dedicated-worker.md).** The Citation Index bulk read uses a dedicated worker and worker-local Snapshot; interactive ZoteroReads retains source change detection and file watching.

> **Amended by [ADR 0073](0073-the-citation-index-reads-in-the-zoteroreads-worker.md).** The Citation Index reads in the ZoteroReads worker again.

Amends [ADR 0050](0050-chunked-work-yields-via-messagechannel.md) for database reads. Applies [ADR 0054](0054-held-reads-serve-the-old-answer-until-a-fresh-read-replaces-it.md) and [ADR 0060](0060-held-reads-are-realized-on-tanstack-query-core.md) unchanged.

The Zotero database lives in one Web Worker. The worker owns the connection, Read Mode selection, the source fingerprint, the file watchers, the debounced single-flight refresh lane, and the Freshness Signal intake. The renderer reads the database only through **ZoteroReads**: an Effect RPC group of use-case operations such as `NoteSource`, `AnnotationSources`, `ItemsByIndexedKeys`, and `DisplayRefs`. Each operation composes the `@zotlit/db` queries inside the worker and returns a plain bundle; the renderer keeps the pure builds that need its resolvers. The renderer holds no database client type and opens no SQLite file.

Obsidian runs Web Workers with Node integration, so `node:sqlite` and `node:fs` load in the worker unchanged. The plugin build bundles the worker entry and embeds it as a string; the renderer spawns it from a blob URL on load and terminates it on unload. One worker serves up to 1,024 concurrent requests. A `Changes` feed, a held Snapshot, and an open stream each occupy a slot for their whole life. The limit is high so normal use leaves slots available for short reads and liveness pings.

## Why

Every read used to run on Obsidian's main thread. On a 10,000-item library in Obsidian 1.14.4, the item index build cut into 50-item slices with a yield between them still stalled a frame for 50–53 ms and produced a 51–57 ms long task; one unsliced read blocked for 7.8 s. The same build on the worker keeps the longest frame gap at the idle floor (19 ms) with zero long tasks, at the same total time of about 5 s. Throughput is the same; the stall leaves the main thread.

Measured on the shipped worker adapter in Obsidian 1.14.4 (rAF gaps and `longtask` entries over the run; idle floor 19 ms):

| Work                                                                         | Library       | Total    | Longest frame gap | Long tasks    |
| ---------------------------------------------------------------------------- | ------------- | -------- | ----------------- | ------------- |
| Item index build (refresh, index, citekey snapshot, and path index together) | 10,000 items  | 5.0 s    | 19 ms             | 0             |
| Citekey snapshot                                                             | 10,000 items  | 50–60 ms | 19 ms             | 0             |
| Citekey snapshot                                                             | 100,000 items | 360 ms   | 83 ms             | 1 (95–106 ms) |
| Batch classify (update-all, before the confirmation)                         | 10,000 items  | 0.4 s    | 19 ms             | 0             |
| Batch classify (update-all, before the confirmation)                         | 100,000 items | 3.8 s    | 50 ms             | 1 (58 ms)     |

The in-process adapter on the main thread blocked 614 ms for the 10,000-item index and about 1.4 s for a 100,000-id classify. The long task that remains at 100,000 items is the renderer handling one large message: the citekey snapshot of a whole library, and the 100,000 item ids that classify reads and sends back. The citekey snapshot now streams in slices, measured before that change; the classify id list is still one message.

## Decision

- **Snapshot replaces the renderer lease.** A Snapshot is a stream operation: the worker borrows the connection inside the stream's scope and emits one id, and every operation that names the id reads that connection. A Snapshot lives exactly as long as its stream, however long it goes unread. The stream ends when the lease is disposed (`await using`), when the scope of `snapshot` closes, when the garbage collector reclaims the reads of a lease that was never disposed, or when the client goes away. A refresh validates the new source first and then swaps it in, so a Snapshot keeps reading the old connection, which closes after its last borrower. The renderer's `acquireRead()` returns a lease bound to one Snapshot. The refresh gate no longer waits for leases.
- **Long reads stream in slices.** The item index, the attachment path index, the citekey snapshot, and batch classification stream from the worker, 500 items per slice by default. A slice runs a fixed set of batched SQLite queries, one per kind of row it needs, so the count does not grow with the ids in the slice. The only extra statement is one group lookup for each library that a stream reads for the first time. The renderer buffers no slice ahead: the worker reads the next slice after the consumer pulls the last, so an abandoned stream costs at most one slice. Slicing sets cancellation granularity and message size; it is not a frame budget. Cancellation is a fiber interrupt and lands at the next slice. The `MessageChannel` yield of ADR 0050 stays for loops over the vault and the UI.
- **Held Reads serve the synchronous surfaces.** Library Scope, graph citation labels, the welcome readout, the attachment path index, and the annotation sidebar hold their last answer and refresh from the `Changes` stream.
- **Gesture-bound writes await one read.** Copy citation awaits `AnnotationSources`, renders, then calls `navigator.clipboard.writeText`; Electron's clipboard is the fallback.
- **Typed values cross the boundary.** `DbUnavailable` and `SnapshotExpired` arrive as tagged errors; `Temporal.Instant` and `ReadonlyMap` fields cross through one Schema codec.
- **A failed worker degrades the database.** A worker error event, a broken `Changes` stream, or a worker that misses its liveness ping twice (a ping every 10 s with 15 s to answer, then a second ping with 5 s, so a timer that ran on through system sleep does not count) moves the service to `degraded` with a `DbUnavailable`; the next refresh spawns a new worker.
- **Tests use the in-process adapter.** The same handler layer runs on the calling runtime behind an in-memory RPC pair over `:memory:` fixture databases. The End-to-end Run proves the real transport.

## Considered Options

- **Keep the reads on the main thread and slice them finer.** The 50-item build still stalls frames, and every consumer repeats its own chunk size, generation counter, and yield. **Rejected.**
- **One "run this query" RPC.** The renderer would compose dozens of round trips per use case, and data across them would not share one database state. **Rejected** in favor of use-case operations with Snapshots.
- **Node `worker_threads`.** A Web Worker already has Node integration in Obsidian, and the Effect platform supplies its spawner and runner. **Rejected.**

## Consequences

- Chromium's task queue is the default scheduler throughout Obsidian. The `@/lib/effect` entry point supplies a cancellable `MessageChannel` scheduler to renderer and worker Effects, including synchronous factories that capture runtimes for later work. The RPC server, refresh work, and Item Index fibers inherit it. The Obsidian import lint rule enforces this boundary. Electron exposes Node's `setImmediate` inside the worker; Effect's automatic selection of that API can starve browser messages and timers even between yielded slices.
- Each new read clone passes the full `PRAGMA integrity_check` in a temporary nested Web Worker before publication. This synchronous SQLite operation keeps the interactive worker free to serve its held state. The verifier closes its handle, and the caller terminates the worker and revokes its URL on success, failure, or a 60-second timeout. The pure Node adapter performs the same check in process. Source equality and WAL commit markers still establish the captured state; integrity validation establishes its structural validity.
- The original `pnpm e2e:worker` command checked unchanged refreshes, three changed-Item rebuilds in a 100,000-Item library, and rejection of an invalid clone while held search results remain available. It measured maximum search latency and an independent worker timer in desktop Obsidian. The gate ran during the affected-path commit hook. [ADR 0116](0116-e2e-timing-limits-use-a-reference-machine.md) now puts timing enforcement in `pnpm e2e:performance` on the designated MacBook. In the red-check run, the old runtime blocked searches for 590 ms on an unchanged refresh and 3,999 ms during a rebuild; both failed the 100 ms limit. The worker timer limit is 250 ms. These are regression budgets on the test host, not latency guarantees on every computer.
- Every database read is asynchronous. Reads that need one database state share a Snapshot.
- The worker posts its log records at the plugin's log level to a `MessagePort` it gets with its spawn, and the renderer emits them into the plugin's logger. The port queues records until the renderer reads it; an RPC stream drops records sent before its subscription, and a raw `postMessage` on the worker breaks the RPC protocol.
- A worker crash can leave a read clone on disk. The renderer sweeps clones by owner after the worker connection closes. The startup sweep removes residue from dead processes.

## Deviations from the spec

- **Snapshot lifetime.** The spec gave an idle Snapshot a safety timeout in the worker. A timer cannot tell a leaked lease from a held one that goes quiet: it ended held leases, whose next read then failed with `SnapshotExpired`. The renderer now ends a leaked lease when the garbage collector reclaims its reads, and `await using` ends every other lease at its block's end.
- **Operation count.** The spec expected about fifteen use-case operations; ZoteroReads has 35. Five are attachment-shaped (`AttachmentsOf`, `AttachmentsAt`, `AttachmentsByKeys`, `AttachmentSources`, `AnnotViewAttachments`), each serving a different consumer's question.
- **`renderAnnotation` removed.** The spec left the unused `renderAnnotation`, `renderAnnotations`, and `getAnnotationsByItemId` for a later cleanup. They read the database from the renderer, which no longer holds a client, so they were removed with this change.

When the read snapshot uses a parent beside the Zotero database, name it `.zotlit-db-reads`. The leading dot hides the working directory in ordinary listings and the name identifies the tool that wrote it. The placement decision lives in the desktop read-parent planner.

## Lifecycle and operation contracts

Subscribe to the lifecycle pubsub before reading the seed so events cannot fall between the current state and the live feed. The first event is the current state. It carries the effective Read Mode while ready and can include a failed refresh's move flag when the prior database is still serving a different path. The desktop source emits the flag to live subscribers but currently omits it from the replay seed. [Desktop replay follow-up](https://github.com/aidenlx/zotlit-repo/issues/86) A late subscriber also receives the cached missing-file event while no database serves. A changed event tells callers to re-query cached results. The worker's spawn input includes an owner tag for reaping orphaned read snapshots and a dedicated port for its logs. A normal shutdown waits for the worker to finish finalizers and acknowledge closure before the renderer terminates it. The renderer can terminate an unresponsive worker after the close timeout.

A Snapshot stream pins one connection until its subscriber ends the stream. Reads carrying that id use the pinned connection. A missing or closed id raises the Snapshot error. The connection readout counts every library independently of Library Scope. The initial search for a library list waits for its index. Later searches can use the last complete index during rebuild. Items that vanish between index build and hydration are omitted, so the answer can be shorter than the limit. Search highlights use half-open title offsets. The worker sends Work Label inputs and the renderer formats them.

Ordered batch lookups keep one entry per requested key or id when consumers need to match by position. Note-path facets return empty lists for unknown Items. Attachment annotation batches keep request order and use one snapshot. Note-ref rows distinguish trashed notes from ids with no note. Keyed Item, attachment, note body, and Work Label lookups omit missing keys. Work Label lookups also omit child Items. Attachments for the annotation sidebar return a standalone attachment on its own, and the reader push converts numeric ids to Indexed Keys at the worker boundary. A standalone attachment has no parent Item and its selected annotation keys include only live children.

A batch can enumerate one library or a collection with its descendants. Regular Items are ordered by descending modification time and notes by id. A collection absent from that library yields null. Tag names are distinct and sorted, and collection paths use root-first names. The Item Snapshot used by the Local Server and note preview resolves the selected library before resolving the Item. A selection failure reaches the caller as `DbUnavailable` through the read boundary. Database Identity names the source used to key excerpt assets. The ping replies without borrowing a database so the renderer can check the worker's liveness independently.

## Renderer connection ownership

The renderer exposes one client and a stable Changes stream across worker lifetimes. On a worker error, transport loss, or failed heartbeat, a host-scope fiber closes the failed connection and publishes degraded. It ignores an already-replaced connection and holds the connection permit through the transition so the next worker cannot report first. Requests fail with a client error while no worker serves. Refresh and Configure can reconnect. Each startup attempt has a bounded wait and a child scope, so cancellation or host shutdown releases its worker. The next worker's state seed is relayed to current subscribers as a change or degraded event when applicable. [Missing-file replay follow-up](https://github.com/aidenlx/zotlit-repo/issues/85)

A worker can stop answering while its transport stays open and emits no error. The heartbeat uses two timeouts so an overdue first timer after sleep does not by itself trigger replacement. Transport errors are handled by the Changes watcher. Skip the normal close wait for a transport that has already ended. A hung worker with a live transport still gets the bounded close attempt. The browser adapter supplies a synchronous spawn callback and handles its message and error events directly, since these events deliver the close acknowledgment and failure reason at the DOM boundary.

The worker protocol sends the close request first. A later finalizer waits for acknowledgments, terminates remaining workers, and revokes the blob URL. When the protocol respawns a worker, terminate the one it replaces and supply a fresh logging channel. Once all workers have ended, start the host's snapshot sweep with the shared owner tag and all database paths used by the connection. The detached sweep lets unload and respawn proceed. Startup cleanup handles residue left behind.

The native service waits for the first Changes event, including a loading seed. It starts its first database read on the service scope so a loading database does not block layer acquisition. State subscriptions replay the current value, and discrete events have their own feed. The view revision follows changed events while subscribed, and the tree discards database data on degradation or a missing file. A failed move also makes the requested source unavailable to views. Open queries recheck their diagnostic when a source becomes unreadable.

Plain callers own leases through asynchronous disposal. Garbage collection can release a leaked lease. A round trip in the disposal test fences the server's processing of the close. A one-item user action reads against a pinned snapshot, returns null for absence or a logged read failure, and preserves interruption.

## Worker connection ownership

The worker validates the required database layout before publishing a client. Layout inspection is cached for that client, so the first reader and the version report can reuse the result. Layout gaps have a distinct error. For other failures, unwrap nested errors to report the SQLite cause behind the query wrapper. Layout and identity failures release the client. Desktop Scope finalizers can still release their resources after validation fails.

A connection records the opened path and Zotero identity before the client starts serving. The key includes the path, account id, local user key, and server id. SQLite Library ids can refer to different Libraries in different databases. A known identity reuses its generation, so the index can compare signatures when reopening the same database. Each client holds its own generation and opened path, even after a swap.

The connection holds the current client in an `RcRef`. Refresh opens, validates, and stages the next client for the next borrow. Keep open and swap in one uninterruptible region so a new client always has an owner. Invalidate the old ref before awaiting disposal of an unused staged client, so a borrow in that interval can take the new client. Active borrows finish on the old client. A failed validation leaves the prior client available and publishes `refresh-failed`. On the fallback path, a direct open also reports a transition to ready or degraded.

Register the Snapshot's cleanup before allowing interruption after its borrow succeeds. Ending the stream removes the id immediately and releases its connection after the last active read. Reads sharing a Snapshot reuse lookup memos for tags, Collections, Library group ids, and the signed-in username. An unpinned call gets fresh memos. Sliced id lookups share the Library memo across pages and assemble one answer per requested id from each batched result. The attachment path stream advances with the last item id of its page, so it reads by keyset rather than offset.

Run one Configure at a time so the index settings, database rebind, and logging level follow the request order. The worker starts with settings from the spawn message. The host supplies the file system for database reads, attachment probes, and Query Job exports. A host without a Query adapter treats a Query Job as a configuration defect. Query Jobs acquire one of two slots and remain cancellable by id while queued or running. A job closes its files before releasing its connection. Request interruption interrupts the job before the request finishes. The Segmenter adapter reads OPFS in the plugin and can take fixture bytes in tests. A host without a store reports an unavailable binary.

The Effect browser runner closes its endpoint as soon as the close request ends its run. Closing the real worker global scope at that point can discard queued finalizers and force the renderer to wait out its close timeout. The worker gives the runner an endpoint whose close is a no-op. Once the server finishes cleanup, the launch observer posts the shutdown acknowledgment and closes the global scope.

Indexed Key lookups group requests by resolved Library, use one batched read for each Library, and reuse the resolved group id during hydration. Answers use the requested key spelling, including leading zeroes in group ids. Collection paths stop at a parent absent from the live nodes, matching the boundary of the visible Zotero tree.

## Desktop Read Modes and snapshot placement

Zotero holds an exclusive SQLite connection while it runs. The Zotero 9 and earlier sources used a rollback journal. Zotero 10 uses WAL and sets exclusive locking before switching modes, so SQLite keeps the WAL index in memory. The adapter checks sidecars on disk instead of branching on Zotero's version. Auto and Reflink try a native clone first. A clone capability failure falls back to a verified byte copy. A source access error or other I/O failure surfaces as a refresh failure. Copy and Reflink capture the database and its WAL in a writable snapshot directory. A read-only SQLite URI allows the clone to create its own shared-memory sidecar and replay committed WAL rows. The copy does not need a shared-memory file from Zotero. [Zotero 10 database implementation](https://github.com/zotero/zotero/blob/10.0.0/chrome/content/zotero/xpcom/db.js#L1551)

Immutable Source also makes an owned snapshot, but copies the main database alone and opens it with SQLite's immutable URI option. A present or unstable WAL raises a freshness warning, since the main file can exclude transactions after the last checkpoint. The original Zotero 10.0 test saw five new rows in the main-plus-WAL clone and zero in an immutable read. The presence of WAL bytes warns of possible lag. SQLite's WAL commit markers determine which rows are visible.

Snapshot placement prefers system temp. Native reflinks need one volume. If both device ids are known and differ, try the namespaced directory beside the database first. A zero device id represents an unknown volume. Keep temp as the sole candidate for an unknown device or a Windows network share, including its long UNC form. This avoids an extra byte copy over the network. A long Windows local path remains a local path. Equal device ids do not guarantee reflink support. The native adapter uses macOS and Linux clone operations and reports other platforms as unsupported.

Recompute the placement on each attempt to prepare a read. A destination that refuses its working directory or runs out of space, quota, or writable storage can fall back to the next placement candidate. Create a fresh child directory even when the parent exists, since recursive creation of an existing parent can succeed on a read-only mount. Source errors and unstable snapshots follow their own failure or retry path. Reflink capability errors change the Read Mode. Cross-device and unsupported-operation errors qualify as capability errors.

Compare fingerprints of the live database and sidecars before and after copying. Compare destination content separately so the copy can have its own inode and timestamps. Include the full WAL digest, since SQLite can reuse rolled-back tail frames at the same size and with the same header. An unstable observation cannot establish equality. An active rollback journal prevents accepting a copy. Retry an unstable snapshot in a fresh directory after a short delay. Keep the prior client if retries fail. SQLite integrity verification establishes structural validity. The native Node fallback runs the synchronous check in process. In Obsidian, use a nested Web Worker because Electron's Node-integrated workers do not provide Node worker threads for this work. Its generated entry owns its SQLite handle and message loop. The caller bridges DOM replies and synchronous send errors into the same Effect.

The acquisition continues independently of the wait because an in-flight filesystem copy can finish after cancellation. Closing the waiter's scope marks the result abandoned. A late copy then removes its snapshot directory. Successful publication transfers cleanup into the client lifetime. Validation may close the SQLite handle before the desktop scope runs its release.

Name each clone with its process id and, where supplied, its worker connection owner tag. The startup sweep keeps clones whose process still exists, including a process that rejects the signal-zero probe with EPERM. Each new database parent gets a sweep because its clones can be outside system temp. Placement and cleanup derive the adjacent directory with the same helper. Once a worker connection closes, sweep its owner tag in temp and beside the database paths it used. Workers in one plugin process share a PID, so that sweep uses the tag. Untagged clones remain eligible for the dead-process sweep.

## Desktop refresh and watches

A read waits for the first refresh to settle. The prior client survives a failed refresh, and explicit Refresh still returns its error. One refresh lane services the request queue. Calls that arrive during a run coalesce into one trailing run that reads again. Each caller in the busy period receives the last run's outcome. The lane captures its filesystem when the layer starts, so its detached sweeps can use it. Schema version reporting uses the cached layout and logs when the version pair changes. A reporting failure does not reject the read. A failed open of a missing database emits the missing-file event once per source lifetime. [Permission-denied follow-up](https://github.com/aidenlx/zotlit-repo/issues/87)

On APFS, cloning can produce a source change notification. Compare the next watcher fingerprint with the pre-read fingerprint to suppress this echo. Recording a fingerprint after the copy could hide a write that landed during copying. Without a reliable fingerprint, refresh. A trusted Zotero signal can refresh with auto-refresh disabled. It routes its burst through the refresh lane and can skip a clone only while the last read is healthy, the settings and source match, and no other request is queued. The companion sends its signal after its checkpoint attempt settles. The watch delay coalesces notifications. Immutable Source uses a shorter delay, watches the main file, and ignores WAL churn because the WAL does not affect its snapshot. A watcher rechecks the auto-refresh setting after asynchronous fingerprinting because the timer may already have fired.

Serialize WAL watch synchronization and watch rebinding, since concurrent callers could each create a watch and overwrite its scope in the holder. Bridge watch callbacks to a queue without starting a separate Effect for each event. The watch startup handshake reports typed errors and synchronous platform throws, such as exhausted watcher limits. After startup, a watch failure logs its full cause. The caller's temporary watch scope closes on startup failure or interruption. The watch holder takes ownership once startup succeeds.

## Regression test boundaries

The desktop source harness subscribes to Changes before Configure so it records startup as well as later transitions. An in-process RPC round trip gives a previously resumed watcher or queued refresh a chance to reach its gate before the test releases a held operation. The harness also drives typed watcher failures, defects from synchronous watch creation, and starts that remain pending until released. It uses real SQLite and uses a Library version to tell which client answered. Tests hold a clone release to cover unload during client handover. They also cover overlapping WAL starts, the watcher loop caused by self-echo, and a debounce scheduled during a refresh that must survive the rebind.

Test the borrow boundary with a small server buffer. A first slice starts the read before the connection swap, the last slice reads after it, and another request names the same Snapshot after the swap. Ending the Snapshot prevents new requests from using its id while an active stream retains the previous client. To detect prefetching, compare statement counts with a consumer holding its first slice while other RPC requests complete. Allow at most the consumed slice and one server buffer slot. A separate test interrupts a fifty-slice stream and verifies the old connection then closes without reading the remaining slices.

Layout validation tests count statements across the version report and other readers to verify that layout inspection runs once. Warm batch-read tests distinguish statement execution from preparation and keep a repeated key, a miss, and live and trashed entries in the fixture. Keep the Library lookup and per-slice SQL budgets visible through assertions. The whole-Library ordering case spans two Item id windows and includes tied modification times so concatenating sorted runs cannot pass. The worker-launch fixture waits for the runner's ready message before asking it to close. It checks that the cleanup marker precedes the close acknowledgment and global scope close.

## Host wiring and embedded worker scripts

The host supplies one CommonJS source string per worker through a virtual module. The renderer spawns a classic script from that string, so no separate worker file ships. Keep the bundle inside a function because a classic script's top-level function declaration can replace a global. Effect declares a private `setImmediate` that would otherwise shadow the native function it calls. The wrapper starts on the original first line to preserve source map line numbers. The test checks that runtime declarations stay local and the intended Effect registry remains available. Vite watches the worker's bundled modules and preserves the required initialization order. Node builtins used by desktop workers remain runtime requires. The worker build rejects imports of Obsidian or Electron because those APIs are unavailable there.

The host captures the desktop file system so a reconnect can reap snapshots without looking up another service. The startup sweep runs independently on the host scope and ends on unload. The worker source derives each snapshot's owner tag from spawn input. Its own runtime supplies the Node file system to the source and its sweeps.

The first configuration uses the loaded Zotero preferences and installed Segmenter. Startup can defer the database open until the workspace layout is ready. The host watches settings, preferences, and the Segmenter and sends only a changed configuration. Reconcile once after the worker handshake because an override can change during connection setup. Keep Read Mode and log level types equal across the settings and RPC boundary.

Item Query integration tests use the real SQLite scenario and an attachment probe. They hold the two job slots so a third request waits and use the staging file and open borrow count to verify interruption. Client settlement can precede the end of a server-side interruption, so the test also observes worker cleanup.

## Template source across the worker boundary

Fetch Note and Annotation source data separately from building the template context. The source contains database values and collections of plain records. Encode each Temporal instant as an ISO string for transport. Template assembly attaches getters, helper functions, and non-enumerable string conversions after transport, where the host has the resolvers. Copy collection records before transport to drop their original string conversion.

Share the tag and collection caches with filename resolution so reading the same Item for its Note reuses those values. Limit collection reads to the main Item and its related Items in the same Library. Fetch Child Note identities with the source and defer their import until a link renders. For annotation-only reads, batch distinct Attachments and their parent Items and build one template bundle per Attachment. An unresolved Attachment omits the Annotation. A standalone Attachment yields an Annotation with a null bibliographic parent. The Attachment-only read can supply context for a new Annotation before its SQLite row exists.

An omitted username lets the reader look it up. An explicit null uses the never-synced account behavior, including the omission of a personal Zotero web link.

A Collection trash operation leaves membership rows behind, so the membership read checks both the Item and the Collection's live state. For template path display, load live nodes once per Library and stop the ancestor walk at the first absent parent. Keep per-Item tag and collection results for the batch so repeated reads use the same facets. The global Tag vocabulary can show every name in the tags table. The Library Tag vocabulary checks applications on live Items because the tags table has no Library column.

The collection resolver keeps its live nodes per Library and reuses resolved paths by Collection ID so siblings can share ancestor work. Scope the cache to a batch because its membership results remain stable for the batch. Zotero's Collection tree rejects moves into descendants, so the path walk can follow parent IDs to the root or an absent parent. Attach collection display coercion after a structured clone. [Zotero Collection move validation](https://github.com/zotero/zotero/blob/9.0.3/chrome/content/zotero/xpcom/data/collection.js#L250-L283)

Use one Attachment file resolver per Query Job. Cache probes by Attachment across the job's rows and treat an unreachable file as missing. Keep these per-row probes untraced.

## Query Job answers and interruption

Use the client's borrowed copy for Library resolution. A named Library can start without waiting for the default Library Scope. Identify the database copy that actually ran the job and include the source ID when it matches the configured database. Query View callers receive JSON row data with the count before the limit. CLI callers receive the versioned envelope. Keep the typed job shapes aligned with the worker contract through declaration merging and compile-time equality checks.

Validate the query and resolve Libraries before opening any staging file. Use exclusive access and owner-only permissions. Await one batch of writes before requesting the next projection batch. An interruption can land between chunks. A native chunk write finishes before scope closure, and the file closes before the connection borrow ends. Capture the file close in a separate scope so a platform close error can become an output diagnostic. An unexpected defect remains a defect. The renderer publishes a completed file from its receipt. The worker sends inline JSON within the configured byte limit.

Drive cancellation tests through a scheduled fiber handle attached before evaluation begins. Use a deterministic clock for checks that count slices. A separate timer task can prove another request advances while the query yields. Simulate interruption during database reads and output writes, plus a writer close failure, because only a complete export receives a publication receipt.

### Renderer job ownership and measurement

Claim a query ID and fork in one synchronous step. Each vault's service owns its own ID map. Tie the job to its caller before enabling interruption. A caller interruption sends cancellation to the worker and waits for the response so the worker releases its writer and borrow before settlement. Layer shutdown interrupts and waits for its jobs. A completed response wins a late cancel. Publish the staging file with a hard link so an existing destination stays intact, and remove the staging path on exit.

The typed Query View request passes plain JSON without a CLI default limit or inline byte limit. It can carry Query Context and Formulas, and a result carries diagnostics for Formulas left out. Return query failures as diagnostics and a caller abort as a cancelled outcome.

Register measurements only in development builds. Measure the normal query path, including a named cancel when requested. Separate worker time from renderer time, and track timer gaps across transfer and publication. Aggregate statements and heap samples in the worker. Treat microtasks as continuation of their host callback and omit waiting time between callbacks. Start a new slice on a scheduler resume when Chromium's MessageChannel resumes it without an `async_hooks` callback. Per-query attribution of interleaved worker activity is tracked in [issue 150](https://github.com/aidenlx/zotlit-repo/issues/150).

### Worker responsiveness gate

Measure the real worker's task queue independently of sequential RPC
latency. A heap sample uses an available CDP session without enabling
one. The optional performance run checks the worker timer on the
reference machine.

[Performance run](0116-e2e-timing-limits-use-a-reference-machine.md) ·
[Worker responsiveness](../../packages/e2e/src/worker-responsiveness.ts)

### CLI cancellation, worker lifecycle, and performance proof

Use a Stress Build large enough for an all-Item export to
remain active when another CLI call arrives. Wait for its private
output file before using the running job ID. Fill both worker
slots with Item exports and cancel a waiting Annotation export.
These datasets use the same job namespace.

To check worker lifecycle across changing Library Scope, flush
pending settings and edit the run vault's own settings and
Fixture copy. The shared source was already copied at creation.
Use the Community Plugins toggle to re-read the file through the
normal startup path. Observe worker creation and termination
across it. Call the registered command and allow brief retries as
the new window settles. Forced worker termination emits no
browser error event, so recovery depends on liveness. Hold a
pending worker read to check that unload ends the recovered
worker and cancels that read.

Keep measurement evaluation separate from running Obsidian.
Apply execution and encoding limits in either process, and
measure window timer gaps for worker runs. Use the nearest-rank
percentile for slice limits. For classes and tiers with a total
budget, use the median of five limited runs. Record unlimited
totals without a total budget. Record separate timer, CLI, and
unload cancellation paths. Measure from the timer's due time or
the request's arrival in the window, and record terminal-to-window
CLI latency separately. A cancelled job can have no complete
trace. A missing cancellation result or missing two-Library part
cannot prove its threshold. The two-Library run combines My
Library with a large group Library. It has slice and cancellation
limits, with totals recorded for comparison. Use the visible
macOS arm64 reference environment for the budget.

[Cancel cases](../../packages/e2e/src/query-cancel.e2e.ts) ·
[Scope cases](../../packages/e2e/src/query-cli-scope.e2e.ts) ·
[Measurement evaluation](../../packages/e2e/src/query-record.ts)

### Measurement run

Build the desktop dev plugin and run the package's `measure:query`
command against reachable Obsidian before release or after planner
changes. Use a separate vault. Run `zotlit:query-measure` through the
same handler as Query, with engine observers. Measure each Stress
Build tier with one Library, then two at that tier's Item count.
Wait for initial fuzzy indexing and Citation Lookup to finish so
their startup work stays outside the measurement.

Measure selective queries, near-cap candidate unions, and scans.
An item-type test supplies no candidate set because Zotero does not
index that field. A query above the cap reads one extra candidate ID
before taking the scan. Use the Fixture's Shared Collection for
annotated Items because the synthetic Stress Build Items have no
marks. In the unlimited two-Library run, compare the default
modified-date order with an empty sort list that orders by Indexed
Key alone. Warm each query once before measuring. Include absolute
worker heap measurements for limited queries and unlimited exports.

Time cancellation at several points before engine execution finishes.
Send CLI cancellation from a separate call with the active run ID.
The arrival in the window ends the measured request interval.
Also cancel through plugin unload, then reload through the same app
API since disabling the instance leaves the enabled list alone.
Record incomplete tiers and which cancellation requests produced no
report. Save the raw results and summary even when a later tier fails.
A threshold failure exits unsuccessfully.

[Query measurement command](../../packages/e2e/src/query-measure.ts) ·
[Measurement record](../../packages/e2e/src/query-record.ts)

The explicit-refresh desktop case leaves file watchers detached so the
Freshness Signal alone publishes the changed title and time. Keep current
Annotation cards visible while rereading. On disable, release vault and
metadata handlers immediately even when worker closure takes longer.
