# Annotation drafts and pending writes stay in memory

The draft and pending-write rules below are extended to Annotation Tags by [ADR 0063](0063-annotation-tags-save-once-per-editing-session-and-merge-by-name.md): a tag draft is saved once when its editor closes, and tags merge by name instead of raising a Write Conflict.

The rule that surfaces show confirmed data while a write is pending, and both amendments below, are superseded by [ADR 0064](0064-surfaces-draw-pending-proposals-from-query-core-mutation-variables.md): every surface draws a submitted write's Pending Proposal until the write settles.

Zotero is the source of truth for Annotation existence and saved content. ZotLit keeps temporary display state, comment drafts, and pending requests in memory. Each Annotation has one shared comment draft, used by both the Annotation View and Mark Popup. Refresh preserves that draft, including its starting value and the user's current text. A changed remote comment requires an explicit choice before replacement; unrelated field changes can refresh normally, and a remote value already equal to the draft needs no write.

Comment edits submit after a one-second typing pause, with a ten-second maximum wait measured from the first unsaved edit. Blur requests immediate submission. Ctrl/Command+Enter also requests immediate submission and keeps the editor open; register it as `Mod+Enter` through Obsidian's native `Scope` for the active editor. Escape closes the editor and requests immediate submission of its latest text. Closing the Annotation View or PDF pane also requests immediate submission; the shared repository continues saving after the pane closes. One request per Annotation runs at a time, while later typing replaces the queued value. An in-flight request or unresolved conflict can delay submission beyond the normal timing.

If editing becomes unavailable, retain the draft for selection and copying, and pause editing and submission. Once connection and authorization permit editing again, the researcher explicitly selects **Save comment** for the held draft before normal automatic saving resumes. Authorization approval itself leaves that draft unsaved. Distinguish a confirmed refusal from an uncertain write result: **Comment not saved. Allow editing, then save again.** applies to rejected authorization; **Save not confirmed. Reconnect to Zotero to check.** applies when the response was lost. These authorization rules were accepted on 2026-09-20 and amend the automatic submission behavior above; implementation must be checked against them. [ADR 0062](0062-editing-requires-a-remembered-authorization-and-allow-leaves-zotlit-read-only.md) removed the separate save rule for Zotero's Allow on 2026-09-25, so only a held draft waits for an explicit save.

Comment drafts live in the shared repository's memory for the current plugin session, including across view closure. Shutdown can lose text that has not been submitted, including newer text queued behind an in-flight write. On restart, annotation comments come from Zotero. This accepts the small loss window between typing and autosave and keeps draft handling simple.

Pending writes live in repository memory for the current plugin session. Each edit submits through the native API once. A success updates the confirmed annotation state and refreshes the shared collection. A failed request or lost response ends that attempt and prompts a refresh from Zotero; the UI reports when saving could not be confirmed. Further changes use the ordinary editing controls. Startup reads Zotero's saved state. This keeps request handling within the active session and accepts losing local operation state at shutdown.

Annotation Cards and Marks show confirmed data while an operation is pending. The active draft or requested change carries its saving state. A lost response can follow a successful write, so the subsequent read establishes the displayed Zotero state. A failed refresh keeps the last confirmed result. Save errors remain visible in the current session, and further submission follows a new editing action.

Zotero owns Annotation existence and saved content. When deletion is confirmed in Zotero, remove the Annotation's card and mark, close its editor, and discard its local comment draft and queued autosave. This keeps deletion handling simple and follows Zotero's state. A failed or incomplete refresh leaves existence unconfirmed and keeps the current state.

Editing release accepts the known native concurrency risk demonstrated in [#1165](https://github.com/aidenlx/zotlit/issues/1165). Overlapping writes to the same Annotation in Zotero and Obsidian can silently overwrite a comment even when both saves succeed. A native deletion can also remove an Annotation updated after its version check. These Zotero defects remain unresolved; their natural occurrence rate has not been measured.

The maintainer accepted this risk on 2026-09-20. Editing release requires a warning in the [PDF annotation editing guide](../../../docs/content/docs/how-to/edit-pdf-annotations.mdx) that attributes the risk to Zotero and recommends editing in one application at a time, with changes saved before switching. Keep Zotero running for native writes. This guidance reduces overlap without guaranteeing conflict protection. Retain the concurrency reproductions and existing conflict handling; the upstream fix is separate follow-up work, and the Companion remains optional. The known races no longer gate editing release. Other acceptance criteria still apply.

This supersedes the creation recovery workflow in [ADR 0039](0039-an-uncertain-create-is-reconciled-by-stable-fields-and-retried-only-by-the-user.md) and amends the reading/editing contract in [ADR 0047](0047-annotation-reading-is-continuous-and-editing-is-an-added-capability.md). Shared memory preserves draft continuity during refresh and between surfaces. Ordinary native API writes and reads provide the save path. The accepted trade-off is a simpler session-only model instead of durable requests, creation matching, or a dedicated retry workflow.

Implementation and acceptance criteria are specified in [Spec #1157](https://github.com/aidenlx/zotlit/issues/1157).

## Amendment: a Geometry Edit draws its proposal while pending

A Geometry Edit is the one exception to confirmed data while a write is pending. The researcher placed the mark with the pointer or the keyboard, so the mark keeps drawing the proposed geometry from release until the write settles. A confirmed write then draws the record Zotero answered. A refused, conflicted, or lost write snaps the mark back to the confirmed record and reports through the existing notice seam. Snapping back to the confirmed record between release and response would show the mark jump back and forth on every edit. Nothing else is drawn from a proposal: the Annotation Card, colour, and comment keep showing confirmed data while pending. Accepted with [Spec #1200](https://github.com/aidenlx/zotlit/issues/1200).

## Amendment: an automatic comment save draws nothing while pending

A comment write in flight is not drawn. The editor already shows the draft's text, and a colour or delete pressed meanwhile queues behind the write, so there is nothing for the verbs to wait on. Disabling them and adding **Saving to Zotero…** under the editor at every typing pause made the card and the Mark Popup flicker. The pending state therefore names its write. Only a gesture's write (colour, delete, geometry, create) stands the verbs down, and the comment editor says it is saving only for a **Save comment** the user pressed on a held draft. A failed, unconfirmed, or conflicted save is still reported as before.

## Amendment: one Annotation Draft per field

An Annotation Draft belongs to one Annotation and one field: the comment, the tags, or the Quoted Text. Each field has its own draft, and the repository keys drafts, autosave timers, held drafts, and conflict reads by Annotation and field. A comment draft and a tag draft on the same Annotation save, are held, and are discarded independently, and a comment draft's Write Conflict leaves the tag draft as it is. The comment rules above apply to every editable text field: the idle and burst autosave timers, immediate submission on blur, Escape, and view close, the held draft after a failed or unconfirmed save, preservation across refresh, the fresh-value read after a refused write, and Write Conflict resolution. A Write Conflict compares only the field of its draft, so a Zotero-side change to another field refreshes normally. The tag field keeps the rules of [ADR 0063](0063-annotation-tags-save-once-per-editing-session-and-merge-by-name.md). Writes on one Annotation still run one at a time, whatever their field. Accepted with [#1236](https://github.com/aidenlx/zotlit/issues/1236) for [Spec #1235](https://github.com/aidenlx/zotlit/issues/1235).

Keep draft identity by field, database and Annotation. An Indexed Key can identify its held draft when no Local API source is active. Bound a continuous run of typing with the burst autosave timer as well as restarting the idle timer on each edit. Remove a due timer from the draft's timer map. [Draft state](../../../../packages/annotations/src/obsidian/annotation-repository/core/state.ts)

Each Annotation can hold one independent draft per field. A text draft keeps its confirmed starting value and current input. A failed or unconfirmed write, or loss of editing while it is open, can make it require an explicit save. Zotero represents cleared text as absent. Hide a draft from a different database and close its editor without submitting it against the newly visible record. Clear record state when a complete read confirms its removal. [Draft model](../../../../packages/annotations/src/obsidian/annotation-repository/core/model.ts)

## Local API request contracts

Create uses a one-object batch POST with a fresh 32-character hexadecimal write token. Zotero 10 generates the key, so the request omits the key and version. Send `annotationType` first because Zotero applies the setters in object order and the other annotation setters require the type. Patch uses the bare item key within its library route and puts the object's exact version in the body. Delete sends `If-Unmodified-Since-Version` because the delete endpoint requires it. Patch and delete send no write token. A precondition refusal on either uses the changed-copy conflict path. Refusals caught in the repository preflight send no write.

Comment and Quoted Text share the per-field draft and save rules. Send an empty string to clear either field. A Quoted Text edit alone preserves the position and Sort Index. A draft that cannot continue its save stays available for explicit submission. [Request builders](../../../../packages/annotations/src/obsidian/annotation-repository/write.ts) · [Wire tests](../../../../packages/annotations/src/obsidian/annotation-repository/write.test.ts)

- [Zotero server_localAPI.js L1889-L1906](https://github.com/zotero/zotero/blob/22f08d1ceddc8bad5718b3bc6eee9d3ae5dccc2c/chrome/content/zotero/xpcom/server/server_localAPI.js#L1889-L1906)
- [Zotero item.js L5677](https://github.com/zotero/zotero/blob/22f08d1ceddc8bad5718b3bc6eee9d3ae5dccc2c/chrome/content/zotero/xpcom/data/item.js#L5677)
- [Zotero server_localAPI.js L2315-L2330](https://github.com/zotero/zotero/blob/22f08d1ceddc8bad5718b3bc6eee9d3ae5dccc2c/chrome/content/zotero/xpcom/server/server_localAPI.js#L2315-L2330)
- [Zotero server_localAPI.js L2160-L2191](https://github.com/zotero/zotero/blob/22f08d1ceddc8bad5718b3bc6eee9d3ae5dccc2c/chrome/content/zotero/xpcom/server/server_localAPI.js#L2160-L2191)
- [Zotero item.js L4512-L4518](https://github.com/zotero/zotero/blob/22f08d1ceddc8bad5718b3bc6eee9d3ae5dccc2c/chrome/content/zotero/xpcom/data/item.js#L4512-L4518)

Run create and command sends on the layer Scope. If the Scope closes before Zotero answers, the outcome is unknown. Preserve a known acceptance, refusal, or server-generated key when closure interrupts only the operation that follows the reply. A patch acknowledgement carries a library version. Read the individual Annotation back for the new object version. Invalidate the collection when that read fails. A delete needs only its acknowledgement. Validate create results per object, publish the returned record, and refresh the Attachment list for Zotero's order. [Write execution](../../../../packages/annotations/src/obsidian/annotation-repository/core/writes.ts)

Reconcile drafts only against complete results accepted for publication from their own database. A saved value equal to the draft ends it. An untouched draft follows the new value. A changed value under typed text creates a Write Conflict. End an unchanged draft before checking save eligibility so it cannot produce a held panel. Keep the last failure visible until the researcher changes the text or explicitly saves again. A successful explicit save clears the hold and lets newer queued text save. A submit of identical text joins the save already in progress.

Each due autosave starts a separate save fiber in the repository Scope with the initiating edit's loggers. This lets the save continue after its timer ends and makes failures visible when no caller is waiting. Discarding a draft cancels its timers. [Draft handlers](../../../../packages/annotations/src/obsidian/annotation-repository/core/drafts.ts) · [Draft store](../../../../packages/annotations/src/obsidian/annotation-repository/core/draft-store.ts)

Acquire the Reader Surface Model registry before its write runner so scope closure waits for writes before it disposes state. Withdraw surfaces while the write scope is still open. This allows a Text Draft to commit during close. Keep the Attachment list held through creation because a closing view releases its own hold before that draft settles.

Cancellation can stop placement or Sort Index work before a request is sent. Once a create or Geometry Edit starts sending, the view waits for the write and its outcome handling. A Text Draft committed by closing also completes placement. Log a failure in post-create handling and preserve the new key. A queued operation waits interruptibly and builds from current state when its turn arrives. Log read failures with the open path and let interruption pass silently. [Reader operations](../../../../packages/annotations/src/obsidian/pdf-annotation-editor/operations.ts)

In tests that exercise actual repository writes, seed a writable Attachment and assert against the fake Zotero's stored record. Advance the repository TestClock for autosave because the timer belongs to Effect rather than Vitest. Simulate a database identity switch to exercise draft hiding. [Reader surface fixture](../../../../packages/annotations/src/__fixtures__/pdf-annotation-editor.ts)

A Geometry Edit can still be cancelled during document placement. Once Zotero has the request, wait for settlement and report its refusal even if the view is closing. A database switch can hide a draft, and editor closure must not start a new draft for the retired database.

The creation harness uses real time for repository reads and manually advances Reader timers. Closing a view during ordinary placement sends no create. Closing during a send waits for its result. A lost reply reports an unknown outcome, and an accepted create keeps its key without showing a failure notice.

The Reader Surface State tests cover a pending write whose repository closes before its reply.

After a foreground create, await the latest refresh before selecting the returned mark. Reader completion promises also let a caller wait for placement or for the displayed marks to catch up to the current read.

The scoped write test begins view closure before the create replies and verifies that the reply can still update the registry before it is disposed.

The test Zotero keeps its own record of accepted writes and generates create keys, including for group Library routes. Assert against that record. Advance the harness runtime's TestClock because the service owns that clock, and wait for the fake transport separately when a timer starts a write.

### Paired write and concurrency proof

Pause one native operation at a controlled boundary, drive
the competing operation, then release the first. Check the
stored result even when both operations report success. In
the observed Zotero version, the API value can replace the
accepted Reader value without a conflict response.

Register restoration before writing the seeded Annotation.
Wait for Zotero's Reader to settle and write the seed back
using the current version. Remove unexpected Annotations that
a previous interrupted create left where the next tool
press must land. Require a real PDF digest before comparing
its final digest.

[Paired write cases](../../../../packages/e2e/src/paired-run.e2e.ts)

### Paired Geometry Edit proof

Measure the handle in a separate callback and wait for scrolling
to settle. The handle takes the gesture when it is the hit-test
target at its center. Hide the popup during the drag and check
that no write lands while the pointer remains down. With editing
disabled the old handle position takes an ordinary page gesture.
The mark stays unchanged. After the release, require both the
expected record and a new version because the Local API can
read pending memory state at the old version. Check the Reader,
overlay, and pixel-change publication separately.

For a conflict, change Zotero's stored geometry during the drag
and release before ZotLit reads it. Read evidence after release
so the probe does not change that sequence. The card offers its
conflict action while Zotero retains the competing rectangle.
End any conflict before restoring the seed. Restore against
the current version after the Reader finishes its image work.

[Geometry and conflict cases](../../../../packages/e2e/src/paired-run.e2e.ts)

After changing position, Zotero's Reader can save a new image
at a newer version. Wait for it before pressing Apply again.
Observe settlement as the attempted geometry at a newer
version or a fresh refusal and conflict choice.

[Apply again case](../../../../packages/e2e/src/paired-run.e2e.ts)

Hold a quoted-text save while changing the record in Zotero.
Release the save after the competing write so it meets the
newer version. The conflict panel stays on the original card
after another card takes selection. Always release the held
write and clear the draft or conflict before restoring the
seed.

[Paused quoted-text write](../../../../packages/e2e/src/paired-run.e2e.ts)

### Paired refresh and unload proof

Read the committed value independently through the Local API.
A failed refresh leaves both rendered consumers on the last
confirmed value. Restart reads Zotero and does not replay
the session attempt. To test an unsent draft, start plugin
unload in the same renderer turn before autosave can fire.
Use the repository registry to observe disposal because the
plugin callback starts it asynchronously.

For an in-flight edit, hold the response after Zotero
commits it. Release it after the replacement repository has
read Zotero. The old operation ends with its unload abort
and cannot reappear or send again. Restore the Local API
preference even when the test fails. Check the Fixture PDF's
digest after all writes because Annotation edits must leave
the PDF unchanged.

To control native races, pause the actual Reader save before
its transaction or pause the native delete at its boundary.
Release the gate and restore the patched method on failure.
Use an independent Local API read as the final oracle.
Restore seeded comments at Zotero's current version.

[Paired lifecycle and race cases](../../../../packages/e2e/src/paired-run.e2e.ts)
