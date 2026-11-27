# Annotation locks come from the Zotero database, apart from the Editing Capability

Zotero's reader locks an Annotation that is External or that another user created in a group library (`annotations.js`: `readOnly = isExternal || !isAuthor`), but the Local API does not enforce this: it checks only that the library is editable, so a write to an External Annotation succeeds and a PATCH to another user's Annotation fails as a bare `500`. ZotLit therefore applies the lock itself, as a Locked Annotation with a Lock Reason, separate from the Editing Capability: the capability describes the connection to an Attachment and changes with probes and authorization, while a lock is a fixed fact about one Annotation. A verb acts only when both allow it. The lock facts — `itemAnnotations.isExternal`, and `groupItems.createdByUserID` compared with the account `userID` in `settings` — are read from the Zotero database even when the Local API is the Annotation Source, because Zotero's item JSON carries neither `annotationIsExternal` nor the creator.

Accepted on 2026-09-26 with [#1233](https://github.com/aidenlx/zotlit/issues/1233). The lock facts sit beside the record set, so [ADR 0034](0034-the-annotation-source-is-atomic-per-attachment.md)'s atomic Annotation Source still holds for the Annotation data.

## Considered Options

- **A per-Annotation value of the Editing Capability** (rejected): mixes a fixed Annotation fact into a connection state defined per Attachment.
- **A ZotLit Companion endpoint that returns Zotero's own `readOnly`** (rejected): exact, but makes a correct edit gate depend on an optional install.
- **Read the lock facts from the Zotero database** (chosen).

## Consequences

- The rule follows Zotero's reader verb by verb: `external` refuses every edit and delete; `another-user` refuses every edit, tags included, but allows delete.
- Unknown facts mean not locked — the database was never read for the Attachment, the Annotation is not yet in the copy ZotLit reads, or no account `userID` exists. Zotero itself counts a missing creator or current user as the author. A new External Annotation stays editable until the copy is read again. A read of the database that fails keeps the locks the last read gave the Attachment, so a known lock does not fall away.
- A group verb on a Card Selection is all or nothing, as in Zotero's reader: it is refused when any selected Annotation refuses it.
- An undo or redo whose History Step targets a Locked Annotation is refused with the Lock Reason, and the step stays. Undoing the delete of another user's Annotation restores it under a new key with the current user as creator, so it is no longer locked.
- A `500` from a missed lock keeps its `invalid-response` mapping; ZotLit does not infer a lock from it.

The sidebar header reports the Editing Capability of the displayed Attachment and updates when either the Attachment or its probe changes. Use the session-level capability while no Attachment is displayed.

Place the Lock Reason beside the page chip where readers can see it before attempting an edit. Use the reason as the lock mark's tooltip and accessible name. [Card lock mark](../../../../packages/annotations/src/desktop/annot-view/Annotation.tsx)

Apply the Attachment's Editing Capability before checking individual Lock Reasons so the user can see and resolve an authorization requirement first. Each verb then uses its own lock rule. A Geometry Edit shares the color gate. Use the first applicable block for a group. Another user's Annotation can still permit Delete, so a different selected record can supply the reason that blocks a group delete. [Lock controls](../../../../packages/annotations/src/obsidian/annot-view/card-controls.ts)

Use the same Lock Reason text for the lock icon, a blocked press, and a refused write. Test a lock refusal before any request, pending proposal, or draft change. When a lock appears during editing, keep the existing draft and stop new input and automatic or explicit saves. The read-only editor shows the reason and a held draft can be discarded. A blocked group action leaves the other drafts and records alone. The test for a held draft checks that it gates history until discarded. A subsequent lock refusal retains the step and keeps its command available.

Obtain the independent lock facts from the database even when the displayed list remains a Local API list. Interpret missing or zero creator IDs as absence of a known different author. Check External first because it also refuses deletion. When a delete of another user's record is undone, report that the restored record is under a new key and has the current user as creator. [Pinned Zotero lock rules](https://github.com/zotero/zotero/blob/9.0.3/chrome/content/zotero/xpcom/annotations.js#L134-L160) · [Lock decisions](../../../../packages/annotations/src/core/annotation-repository/lock.ts) · [Lock integration tests](../../../../packages/annotations/src/obsidian/annotation-repository/service.locks.test.ts)

Store lock facts separately from the published list, so a changed lock can apply even if the list itself does not change. Reuse the joined list when both it and its locks are unchanged to avoid a redraw. [Lock state](../../../../packages/annotations/src/obsidian/annotation-repository/core/state.ts)

A database lock read may finish after a Local API list query is cancelled. It can keep the lock facts if its database generation still stands. A generation change leaves the prior locks in place until the new read can refresh them. Reread the account user ID with each database list so a first sync can change authorship locks. Announce lock-only changes so visible Local API lists redraw with current locks. [Lock reads](../../../../packages/annotations/src/obsidian/annotation-repository/core/lists.ts) · [Cancellation test](../../../../packages/annotations/src/obsidian/annotation-repository/service.reads.test.ts)

A lock refusal happens before the repository sends a request. Keep the session capability and show the lock reason for that action.

Read the lock before sending a write. The lock can disappear from the database as soon as Zotero deletes the Annotation. A lock refusal preserves any standing conflict and publishes no Pending Proposal. Check all locks before sending a grouped recolor or delete. A single refusal prevents every request and preserves every draft. Return the first lock reason for the group. If Editing Capability also blocks the operation, use its reason first so the UI can offer its action.

When a lock blocks a text edit, keep the draft already held and refuse the save before it becomes pending, including a save queued behind an earlier write.

Exercise imported-PDF locks by importing into the fake Zotero database and signaling a database refresh, so the repository reads the lock from its real source.

A Locked Annotation exposes no Geometry Edit handles or body drag. For a group verb, check the first refusing lock before showing any delete confirmation. Report that lock directly. The selection tests cover a lock learned while a pointer gesture is still active.

The Reader Surface State offers handles only to a single selected, editable and unlocked mark.

Seed a group Library's recorded creators separately from its signed-in user. Test a missing creator row independently of a row with no creator. An External Annotation import is visible after the database refresh.

### External Annotation lock proof

Use a Fixture PDF with an embedded highlight and no seeded Annotation.
Open it in Zotero to import the highlight, then confirm the lock in the
Annotation Card and Mark Popup. Reset the Attachment to its unprocessed
state so the next run imports again. Establish Write Authorization first
so a refused edit demonstrates the lock. Retry card selection while
waiting for the card and press the control under test once. Start the
Mark Popup check from a fresh reader binding so the mark click opens
the popup. A locked card reports its Lock Reason without offering an
override or confirmation. A locked popup supplies the reason in its
tooltips. Pressing its dimmed controls leaves the popup open and
starts no edit. Verify the lock in a popout and check that Zotero's
Annotation remains unchanged.

[External Annotation lock case](../../../../packages/e2e/src/annotation-lock.ts)

Wait for the Annotation Card to show the blocked capability
before checking that the Edit quoted text action opens no
editor.

[Blocked edit case](../../../../packages/e2e/src/paired-query.e2e.ts)
