# The Annotation Source is atomic per Attachment

Amended by [ADR 0047](0047-annotation-reading-is-continuous-and-editing-is-an-added-capability.md): both surfaces present one continuous annotation collection. Source selection stays internal, refresh preserves the published result until a complete replacement is ready, and source handoff preserves acknowledged writes.

Protocol correction from the 2026-09-19 source review: Zotero stores item and library `clientVersion` in its database. The old implementation below omitted these columns from its read model. Database reading remains a read-only adapter by design; version availability is not the reason writes use the native API.

The annotation repository reads an Attachment's Annotations from one Annotation Source at a time: the Zotero Local API while Zotero answers the capability probe, otherwise the Zotero DB through the database service. The switch is capability-driven, never per request, and a read result carries its source. The two record sets never join — the prototype's projection of Zotero Local API fields onto DB rows keyed by Indexed Key, which dropped every remote-only row, is not carried forward. Reads on the Zotero Local API need no key, so an unauthorized session still reads from it; authorization gates writes alone. Both partitions live in one query-core cache behind the repository, and the DB partition is dropped wholesale on every database refresh.

## Considered Options

- **Project remote fields onto DB rows** (rejected): an Annotation created in Obsidian is missing until SQLite catches up, and a stale DB row can carry a live version number, which is exactly the mix a `412` conflict cannot untangle.
- **Per-request fallback** (rejected): two adjacent Attachments could render from different sources, and one list could show a card the other cannot edit, with nothing to explain why.
- **One source per moment, replaced atomically** (chosen): a record set is either wholly writable, with versions, or wholly read-only, and the source travels with the result so a surface can say which it is.

## Consequences

- A write while the source is the Zotero DB is refused with a typed failure before any request, because the DB partition holds no versions.
- Consumers learn of a switch through the repository's own change event and re-read; nothing patches a list in place.
- The Zotero DB partition may be older than the Zotero Local API partition it replaces; the result's source and capture time are what a surface shows, not a merged "best of both".

The Annotations Layout reads the repository's list per Attachment. Cards use that list's Annotation Source and records, which are also the source and records the PDF overlay uses. Capability changes propagate per Attachment without switching the layout's other lists. [Layout](../../../../packages/annotations/src/desktop/annot-view/layout.tsx)

Store each visible Attachment's Annotation Source with the data directory used for the read. A card uses its own Attachment's entry when resolving an Excerpt Image. [Card state](../../../../packages/annotations/src/obsidian/annot-view/state.ts)

When a failed Local API list read stands the session down, deliver its source-change notification to the repository before returning the failed read to the caller. The repository announces the affected held Attachments. If the database copy does not yet contain a confirmed Local API edit, the held Local API list can stay visible while a current database read still updates its lock facts. [Source ordering test](../../../../packages/annotations/src/core/annotation-repository/source-order.test.ts) · [Lock integration tests](../../../../packages/annotations/src/obsidian/annotation-repository/service.locks.test.ts)

Announce a database change only after a capability probe adopts the new database. A quarantined read or a write with a server-change response starts that probe. Key the notice to the latest adopted database so later requests and unrelated capability refreshes cannot repeat it. A switch back to a former database is a new change. [Notice decisions](../../../../packages/annotations/src/obsidian/annotation-repository/capability-notices.ts)

Batch Annotation Repository reads by database generation. The batch shares one snapshot for the Annotation rows, Libraries and database identity. A later generation cannot reuse the earlier batch. Run started batches on the layer's fibers so layer closure interrupts their work and releases the snapshot. If every caller cancels before the batch starts, take no snapshot. A requested key absent from the batch response is a resolver defect. [Batch reader](../../../../packages/annotations/src/obsidian/annotation-repository/core/bridge.ts) · [Batch tests](../../../../packages/annotations/src/obsidian/annotation-repository/core/bridge.test.ts)

Track the database identity and revision for each Attachment list. Compare complete reads only within their database to determine which Annotations are gone. Remember acknowledged Local API writes until a later complete read includes their results. Keep explicit revalidation scoped per Attachment. Batch reads for overlapping holders in the same task and generation even if two views request them. Releasing one holder keeps a list the other still holds. Releasing the last holder can drop it and notify a reader without a hold, which can publish it again. A list read without a hold remains visible until a database change. At that change re-read lists with recent requests and evict older ones instead. [Repository state](../../../../packages/annotations/src/obsidian/annotation-repository/core/state.ts) · [Scale tests](../../../../packages/annotations/src/obsidian/annotation-repository/scale.test.ts)

## List partitions and in-flight reads

Choose one source per request. Keep database lists by Attachment and database generation, and Local API lists by server ID and Attachment. Build the database records with the Attachment's content type. A missing library binding keeps the Local API candidate from replacing the verified list. Publish a source adoption before announcing the capability and list changes it enables. When a source moves, invalidate its partition and announce affected Attachments so readers can ask again. A refreshed database advances the generation and old candidates cannot publish.

A surface hold or work in progress keeps a list in use. Releasing the final hold can drop the query and announce both visible and waiting lists. A background reread does not extend the last request time. Concurrent explicit revalidations join the fiber already running in the layer Scope. If refreshing the database fails while its old snapshot remains readable, the read can still use it. A synchronous reader gets the held list and its status together.

Local API reads take the query AbortSignal. Cancelling an invalidated read prevents it from publishing and leaves the Local API session standing. The database batch is owned by the repository Scope. Closing it ends the query and releases its snapshot. A Local API interruption at layer close leaves the outcome unknown, which is distinct from a transport failure and can leave the database list available. Releasing a hold after close is harmless.

Keep the Local API list while a write is in flight against the same database. Temporary unavailability does not invalidate the identity used to apply its acknowledgement. After acknowledgement, require a database snapshot at the acknowledged Library revision before it can replace the visible list. A newer snapshot with no matching record can prove deletion of a previously confirmed record. [Repository lists](../../../../packages/annotations/src/obsidian/annotation-repository/core/lists.ts) · [Read tests](../../../../packages/annotations/src/obsidian/annotation-repository/service.reads.test.ts)

The normalized record carries an object version when its source can supply one. The database adapter remains read-only. A direct read-back can confirm a newer object version, which an older collection read must preserve. [Record model](../../../../packages/annotations/src/obsidian/annotation-repository/core/model.ts)

Read the current time through the repository layer's Clock so reads use the same clock from every calling fiber. A failure during core dependency construction is a defect. [Repository service](../../../../packages/annotations/src/obsidian/annotation-repository/service.ts)

After the last write settles, refresh from the database when no Local API source stands. If the database changes during a send, check the binding against the new database before publishing. Layer closure waits for a started binding check to release its snapshot. [Write execution](../../../../packages/annotations/src/obsidian/annotation-repository/core/writes.ts) · [Integration tests](../../../../packages/annotations/src/obsidian/annotation-repository/service.writes.test.ts)

The repository harness exercises a real query client and Local API client through a fake transport. Reuse it in Reader tests so pending state, failures, and conflicts come from the same source. Seed the Rougier Fixture's six Annotation types and shorten the ink paths for transport tests. Add an EPUB Attachment to exercise content-type narrowing. A database lease can represent the snapshot opened before a refresh. Subscribe before triggering an operation when a test needs the complete set of list notifications it emits. [Repository harness](../../../../packages/annotations/src/__fixtures__/annotation-repository.ts)

## Local API replies and Annotation validation

Use API version 3. Treat an incompatible version or HTTP 501 as an API
mismatch. Record the schema version in diagnostics. Request fresh reads so
the version cached by a transport does not hide an updated Library.
A probe can establish a server identity. Later successful replies must
carry that identity. Classify a differing identity before applying any
reply to the held data. A refusal can identify itself by status without
the server header, as Zotero's unauthorized reply does.

Distinguish conflicts, server changes, and reused write tokens even when
they share HTTP 412. The tests use captured replies to preserve these
differences. A write's HTTP 404 means Zotero cannot find the object. The
Capability Probe treats a 404 as unreachable. Preserve Zotero's prompt
cooldown and use its default window if Retry-After is absent or unreadable.
Return failures as results so callers can choose when to refresh, wait, or
keep the prior data. [Zotero Local API implementation](https://github.com/zotero/zotero/blob/22f08d1ceddc8bad5718b3bc6eee9d3ae5dccc2c/chrome/content/zotero/xpcom/server/server_localAPI.js)

Validate the Indexed Key before routing. Validate every incoming
Annotation before admitting it to the cache, including its key, parent,
colour, type, position, Sort Index, and object version. The zero-padded
Sort Index sorts in reading order and preserves Zotero's PDF, EPUB, and
snapshot formats. Use the stored position shape to distinguish PDF
geometry from EPUB and snapshot selectors because the Annotation lacks
a content-type field. For PDF, match the separate ink and text shapes to
their types. Keep Zotero's page label and ordered tags. Tag type defaults
to manual when omitted. Accept a missing creation date. Zotero uses empty
strings for empty Annotation fields.

Use Zotero's total-result header to end pagination. Read an edited
Annotation back after HTTP 204 because the header reports the Library
version and the next write needs the object version. A create can report
an object-level failure under HTTP 200. Inspect the indexed result and
validate the created record against the reported key, requested parent,
and requested type. Keep the complete validated record available if a
later collection refresh fails.
[Wire validation](../../../../packages/plugin-services/src/core/zotero-local-api/wire.ts)

## Session probe and list lifetime

The first source read requests a Capability Probe and can return no Local
API source while that probe runs. Reading the last capability alone does
not start one. The probe determines whether the Local API is enabled.
The profile preferences supply its port. Keep probes time-bounded so a
hung server cannot leave the source undecided. A root reply without a
server ID can be from Zotero 9, which serves API version 3 reads but does
not support this editing session.

Concurrent callers share a probe on the session Scope. Keep the prior
source while a repeat probe runs. A Freshness Signal arriving during
an active probe is kept for publication. A profile or data directory
change invalidates the reply from the earlier port and runs another
probe before settling the waiters. The last move check shares the same
state update as release of the probe slot. Propagate the probe's exit
to waiters. Announce material capability changes only, because a quiet
focus probe must not rebuild the control under the pointer. Keep source
reads untraced because the Annotation Repository requests them repeatedly
while rendering. Notify database adoption from the probe.

A failed list read stands down the session and publishes the change before
returning. An interrupted read or unknown outcome can leave the session
standing. Read an already-acknowledged edit back without standing down the
session on read-back failure. Its caller can drop and reconcile the list.
Walk each Attachment list in date-added order, which an edit does not
reorder, to keep page boundaries stable across edits. After validation,
sort the complete list by Sort Index because the endpoint cannot sort by
that field. [Local API session](../../../../packages/plugin-services/src/obsidian/zotero-local-api/session.ts)

## Local API fixture provenance

The fake transport replays recorded and contract-derived fields through
the real client. A Paired Zotero 10.0 run on 2026-09-16 supplied the
common reply headers, item and Library envelope, authorization replies,
conflict and write-token replies, and result-count and pagination
headers. A list read on the same date supplied the Fixture Attachment’s seven
creation timestamps at UTC second precision. The test uses those
timestamps for uncertain-create comparisons. Its Annotation-specific
fields come from the Fixture Spec so the database and wire sources
describe the same records. Object versions in the fixture are synthetic.

The root probe combines the recorded headers with Zotero's documented
root body. The page fixture combines recorded pagination headers with
synthetic page contents. The single-item builder uses the recorded item
and Library envelope but omits unused links and metadata. The create
fixture derives the indexed result envelope from the upstream
multi-object handler. Disabled API, incompatible version, read-only
Library, and foreign server scenarios use contract-derived replies.
[Fixture guide](../../../../docs/fixture.md#trial-the-zotero-local-api) · [Wire fixtures](../../../../packages/plugin-services/src/obsidian/zotero-local-api/__fixtures__.ts)

Recorded replies distinguish a missing item on DELETE or single-item GET
from an empty children list. A PATCH of a missing object can return
HTTP 400 because Zotero treats it as a create without an item type.
Object-version conflicts use different wording for DELETE and PATCH
but both map to a conflict. A revoked or spent key returns HTTP 401
without the challenge header carried by the missing-key reply.

The fake transport can hold a list reply until the caller completes
or cancels it. Its shared TestClock controls the probe deadline, and its
profile override can move the port while a probe is pending. Tests cover
a profile move after a probe publishes but before its waiters settle.
They also exercise a Freshness Signal during a probe and a repeat
focus probe that must leave the reader control in place.
[Session tests](../../../../packages/plugin-services/src/obsidian/zotero-local-api/service.test.ts)

### Shared PDF proof

Use a Fixture where two Attachments share a file. A link that names
the Attachment not indexed by path binds and selects that Attachment
in Obsidian. Sample the Attachment identity at each ledger read.
The first read must already name the linked Attachment. Also start
with a tab loaded before ZotLit starts. Plugin startup alone does not
record an open. An explicit open can end that tab's previous read
and begin the named Attachment's read. Open another tab on the same
file to check that each tab and its following Annotation View use
their own Attachment. Restore ledger state with the other test data.

[Shared PDF cases](../../../../packages/e2e/src/annotation-links.e2e.ts)

### Zotero Reader write settlement

After a position write, wait for the Zotero Reader to report the
stored position and modification time with no pending save. Image
and ink writes can invalidate and regenerate the excerpt after
the database write. Require its cache image and two agreeing
Local API versions across consecutive Reader-ready polls. Wait
past the last modification second for image and ink because
Zotero only renders again for a later timestamp. Keep Reader
window and tab evidence on timeout. Record every fresh key for
cleanup before asserting that exactly one Annotation was made.

[Paired Reader setup and observations](../../../../packages/e2e/src/paired-zotero.ts)

### Paired surface proof

Check that the linked PDF resolves to the Fixture Attachment
inside the run vault. First lookup can return pending while the
Held Read builds its path index. Check the Companion freshness
connection and Local API Annotation Source before writes so a
setup failure cannot appear as a later rendering timeout.

Open Zotero's Reader before writing. Read the Local API and
the Annotation held by that Reader separately. Hold the
ZotLit Query worker after creation to prove the Annotation
View can show the repository's live row before a query reruns.

[Paired surface cases](../../../../packages/e2e/src/paired-run.e2e.ts)

Confirm the Local API source before testing a saved edit
through a Query File tab, Query Block, or embedded card.
A test can write through Zotero's own data layer over RDP
to exercise the same Freshness Signal as a Reader save,
without claiming a Reader gesture. For child-list evidence,
request Annotation children and use date-added order to
keep page boundaries stable.

[Paired freshness and surface cases](../../../../packages/e2e/src/paired-run.e2e.ts)
