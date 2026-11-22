# Surfaces draw Pending Proposals from query-core mutation variables

Supersedes the "confirmed data while pending" paragraph of [ADR 0048](0048-annotation-drafts-and-pending-writes-stay-in-memory.md) and both of its amendments, and the rejected option "Close at once and draw the draft chips as pending" of [ADR 0063](0063-annotation-tags-save-once-per-editing-session-and-merge-by-name.md). Builds on [ADR 0060](../../../../docs/adr/0060-held-reads-are-realized-on-tanstack-query-core.md).

Decided on 2026-09-25, after a comment saved on blur made the Mark Popup show the old comment for one frame. The editor closed, the draft was pending, and every surface drew the confirmed record, as ADR 0048 asked. Each surface had its own exception for this gap: geometry drew the drag's proposal until the write settled, the tag editor stayed open in a saving state, and the comment editor had none. We removed the exceptions and made one rule at the repository.

Every Annotation write that changes a field runs as a `@tanstack/query-core` mutation in the plugin's `MutationCache`. Its variables are the write's **Pending Proposal**: the comment, colour, tags, or position, sortIndex, and text that Zotero will store. The mutation's scope is the Annotation, so writes to one Annotation run in order, and a write that waits behind another is already `pending` with its variables. This follows TanStack's "optimistic updates via the UI" pattern: the query cache keeps only confirmed data, and the proposal is read from the pending mutations.

The repository's published list (`read()`, `peek()`, and the Held Read it announces) is the confirmed list with each pending mutation's fields applied over it, later writes over earlier ones. Everything that decides a write reads the confirmed list: versions, Write Conflicts, the tag merge, and History Steps. A proposal applies only over a list from the Zotero database that the write was sent to. The repository announces `annotations-changed` synchronously when a proposing write starts and when it settles, and the Annotation View and the PDF binding draw from `peek()` in the same task, so there is no frame between the closed editor and the new value. A confirmed write then draws what Zotero answered; a refused, conflicted, or lost write draws the confirmed value again and reports as before.

The tag editor closes at once onto the proposed chips. A Geometry Edit draws the Reader Surface State's drag proposal while the pointer is down and the repository's proposal from release, rounded as Zotero stores it. Pixels (the Excerpt Image) are announced only on confirmation. Delete and create keep their visible behaviour. The `MutationState` a surface reads for saving, failure, and verb stand-down is unchanged.

A comment saved behind a comment save in flight coalesces: a waiting comment mutation sends nothing when a later comment or delete write waits after it, or when its draft is gone or in conflict. Only the newest text reaches Zotero.

## Considered Options

- **Write the proposal into the query cache and roll it back on failure** (TanStack's "via the cache" pattern, rejected): the cache feeds versions, conflicts, the tag merge, and History Steps, which must see only confirmed values. Concurrent writes also need the rollback bookkeeping described in "Concurrent Optimistic Updates in React Query", which the scoped mutation variables make unnecessary.
- **A hand-rolled proposal map beside the query cache** (rejected): query-core already holds each write's variables, status, scope order, and settlement, and the repository already depends on it.
- **Keep per-surface exceptions and add one for the comment** (rejected): each new field would need its own gap fix, and the surfaces would disagree about what is saved.

## Consequences

- A filter, a note insertion, and a copy read the displayed record, so they see the Pending Proposal.
- The query-client service pins Query Core's focus to true. A mutation that waits in a scope starts only while Query Core counts the window focused, and with no mounted client it reads that from the document, which a minimised or covered window reports hidden. This keeps ADR 0060's rule of no focus tracking.
- A comment save applies its outcome to the draft before the next write on the Annotation starts, so a save queued behind a failed one is held for **Save comment**, as ADR 0048 asks.
- `MutationState` reads its `pending` from the same mutation cache: an Annotation is pending from the moment a write is asked for until the last write queued on it settles, and names the write in flight. The repository keeps only the failure or conflict a settled write leaves standing, and announces `annotation-changed` in the same task as a write starts and settles. A queue of writes on one Annotation therefore never shows idle between them.
- One signal carries everything the repository holds about one Annotation beside its record. `annotation-changed` replaces `mutation-changed`, `comment-draft-changed`, `comment-draft-hidden`, and `annotation-deleted`, which [ADR 0056](0056-reader-surface-state-is-one-vanilla-store-per-pdf-view.md) names. A surface re-reads one snapshot, `annotationState(key)`: the `MutationState`, the comment draft, the tag draft, `hidden` (a database switch hid a draft, so its editor closes with nothing to save), and `gone`. The record stays on `annotations-changed`.
- `gone` is true for every Annotation that a complete read no longer answers, with a draft or without, so the Annotation View and the Reader Surface State use one rule to close its editors and drop its record.
- One rule decides the tag names and the comment text that every surface draws (`shownTagNames`, `shownComment`): the draft's value while it is edited, held, or failed, and the record's value, which holds the Pending Proposal, from the moment the draft saves.

Show each text field's conflict in its own place even while a different field saves. When a blur starts a text save and Escape closes the editor, keep the typed text visible while the save is pending. [Card editor tests](../../../../packages/annotations/src/desktop/annot-view/Annotation.test.ts)

Submit an editor's closing write on the plugin-lifetime command so closing the editor or its view leaves the write running until completion or plugin unload. Accept writes from multiple cards and views concurrently. [Annotation write command](../../../../packages/annotations/src/desktop/annot-view/atoms.ts)

When a tag draft ends, read the held list in the same update that removes the draft so the card draws the saved chips immediately. Unmount the tag editor while its save command is still mounted. A closing text editor submits its stored draft and reports a failed write in a notice. [Layout write handling](../../../../packages/annotations/src/desktop/annot-view/layout.tsx)

Distinguish an automatic save on blur or close from an explicit save. A field-specific retry or discard acts on that field's conflict. Without a field, act on the Annotation's standing conflict. Retrying starts from the value Zotero holds. Discard keeps that value and drops the draft. [Card draft actions](../../../../packages/annotations/src/desktop/annot-view/actions.tsx)

Give each text field its own draft panel in the field's slot. Pending work on another field cannot hide it. A color, delete, geometry, or draftless text conflict uses the card's general conflict slot. Show the attempted and fresh values there and leave the surrounding card on the saved record. The held panel shares the conflict panel's surface because both ask the researcher to resolve local text. Its controls claim their own clicks, and the field's entry can reopen the editor. [Card draft panels](../../../../packages/annotations/src/desktop/annot-view/Annotation.tsx)

## Shared editor and conflict presentation

Keep tools available during automatic text saves and tag session saves to avoid a flashing toolbar. Other actions can queue behind a text save. A tag undo or redo is a gesture write and does disable those controls while it is pending. Use the text draft in an open editor even during a save because later typing can be newer. A closed field draws the record with its Pending Proposal.

Keep automatic saves quiet. A user-initiated pending save displays its status, and a draft that requires explicit save exposes its button. Use the current block's reason to explain unauthorized or locked writes. A held panel gives an action the researcher can use. Its accent follows Save or Allow editing when that is the available path. Discard stays available without the accent. Preserve the panel DOM for equal content, reasons and actions so an update cannot remove a button between pointer press and release.

Describe a Write Conflict as data for both tests and rendering. Show Zotero's fresh value before the attempted value. Use the text field's name in its two actions. A delete shows an explicit prompt against the refreshed card. A Geometry Edit names what moved and compares Quoted Text when the edit includes it. A lock leaves Discard as the only action. [Editor controls](../../../../packages/annotations/src/obsidian/annot-view/card-controls.ts) · [Conflict panel](../../../../packages/annotations/src/obsidian/annot-view/card-conflict.ts)

Share panel builders across the card and Mark Popup and inject each surface's write callbacks. A held tag panel displays chips where a held text panel displays the draft. Use the popover fill so the native resting buttons remain distinct. Give a reason that wraps in a narrow dock readable leading. A blocked conflict retry stays disabled while Discard remains available. [Panel builders](../../../../packages/annotations/src/obsidian/annot-view/editor-sheet.ts)

In the component wrappers, call the editor sheet and panel builders with callbacks that read the latest render. Keep equivalent held panels by value so an unrelated render leaves a press in progress intact. [Comment wrappers](../../../../packages/annotations/src/obsidian/annot-view/comment-parts.tsx) · [Tag panel wrapper](../../../../packages/annotations/src/obsidian/annot-view/tag-editor.tsx)

Each view observes the repository's shared text and tag drafts by Annotation Indexed Key. An absent mutation entry means idle. The editing target and the saving tag draft have separate lifetimes, so closing the editor leaves its pending draft visible. [Draft state](../../../../packages/annotations/src/obsidian/annot-view/state.ts)

An off-screen Write Conflict has one notice per Annotation while it stands, with an action that reveals its card. Resolving or clearing the conflict re-arms the notice so a later conflict can be reported. [Conflict notice decisions](../../../../packages/annotations/src/obsidian/annotation-repository/capability-notices.ts)

Suppress an off-screen conflict notice when a visible Annotation View already shows the card. In other cases its action reveals the card. Clear the notice record when the Annotation no longer holds a conflict. [Notice delivery](../../../../packages/annotations/src/obsidian/annotation-repository/notices.ts)

Show the oldest outstanding mutation while writes for the Annotation are queued. After they settle, show the latest standing failure or conflict. A new write takes over existing failures and its own field's conflict. Conflicts on other fields can still stand. A caller joining an in-flight write waits on its stored operation. Publish its outcome after it leaves pending state.

Resolve a rejected write silently when the fresh value already equals what the edit asked for. Treat absent and empty comment text alike. Use wire rounding for Geometry Edits and compare Quoted Text only if the edit proposed a text value. A refused delete has no value to compare, so ask against the fresh record. [Mutation outcomes](../../../../packages/annotations/src/obsidian/annotation-repository/core/outcomes.ts) · [Conflict comparison](../../../../packages/annotations/src/obsidian/annotation-repository/reconcile.ts)

Draw the pending proposals over the confirmed list for their database only. If queued proposals overlap one field, the later proposal draws over the earlier one. [Published list](../../../../packages/annotations/src/obsidian/annotation-repository/core/lists.ts)

A queued command sends nothing if the repository closes before the command starts. Keep the Annotation visible until Zotero acknowledges its deletion. Leave high-frequency card state accessors untraced because the Annotation View calls them per Annotation or per field. Group write notices list each distinct failure reason once. Show a conflict on its card. Share the capability reason with the editing controls and return a clause so create, update, and delete notices can provide their own wording. [Repository service](../../../../packages/annotations/src/obsidian/annotation-repository/service.ts) · [Write notices](../../../../packages/annotations/src/obsidian/annotation-repository/write.ts)

Run Annotation mutations with Query Core's network mode set to always because the Local API is on the same device. All callers of a write and its joiners wait on its mutation promise. Notify surfaces of the settled state before releasing those callers. Publish a confirmed record independently of the original transport cache's lifetime. Read the individual Annotation after a version refusal to get the current value and version. A retry uses that version. Invalidate the Attachment collection after reconciling the refusal. A missing Annotation also invalidates the collection so the next read can remove its card. [Write execution](../../../../packages/annotations/src/obsidian/annotation-repository/core/writes.ts)

An accepted complete read can remove an Annotation that appeared in the prior collection or still has a draft. End all of its drafts and standing write state, then announce that it is gone so open editors close. Keep the Pending Proposal on a refresh that returns the old value while the write is in flight. The proposal expires on refusal and the read-back value supplies both the card and the conflict. Each field can hold a separate conflict or draft. Surfaces re-read the current snapshot, so repeated notifications can expose the same state.

A grouped Reader write reports each distinct failure reason once. A plugin unload interrupt passes through without a write notice.

The Reader test harness draws the held list synchronously on a repository announcement and draws the next read when it arrives. This exercises the same Pending Proposal and refusal transitions as the binding.

Draw a released drag's proposal during Sort Index calculation. Once the write starts, draw the repository's Pending Proposal. Success draws the confirmed reply and refusal draws the saved record. The Reader raises the write notice through the Notifier. A comment draft conflict remains visible when another field has a later outcome. Pending state starts in the gesture's task, so tests can use it to wait for the writes started by that gesture.

On a complete deletion, remove the record, write outcome and drafts together. A database switch closes the editor for the draft it actually hid, once. An ordinary save can remove the draft while leaving the editor open. A comment conflict closes the editor in the same update so the popup can offer its conflict actions.

Draw the held list with any Pending Proposal in the notification's task. Follow it with a read. Use a refresh serial to ignore results of reads superseded by later requests.
