# Annotation History is per Attachment, checked by field value when undone, and restores under a new key

Amended by [ADR 0063](0063-annotation-tags-save-once-per-editing-session-and-merge-by-name.md): the undo of a tag editing session reverses its added and removed names against the current tags instead of checking field values.

The Geometry Edit and ink specs ([#1200](https://github.com/aidenlx/zotlit/issues/1200), [#1207](https://github.com/aidenlx/zotlit/issues/1207)) left undo out because "Zotero holds no history, and neither does ZotLit". ZotLit now keeps an Annotation History: an ephemeral record of its own confirmed edits, one per Attachment, recorded in the annotation repository that every surface already writes through. It starts when the first PDF view of the Attachment opens and ends when the last one closes. A History Step holds the before and after values of the fields it changed, taken from confirmed records, so a failed write never enters it. An undo is an ordinary write through the same verbs: it first compares the step's after values with the current confirmed record, writes the before values when they match, and otherwise drops that one step with a notice. Redo is built from the undo's confirmed result, and a new edit clears it.

## Considered Options

- **One history per PDF view, as Zotero's reader keeps one per reader** (rejected): an edit from a card or from a second view of the same PDF would be a foreign change to it, so ZotLit's own edits would cut its own history.
- **Cut every step on an Annotation when Zotero reports a change to it, as Zotero's reader does** (rejected): it needs a listener on outside changes and throws away steps whose fields Zotero never touched. A check at undo time needs neither, and an outside edit to a different field does not block the undo.
- **Check the Zotero version recorded with the step** (rejected): each undo of an earlier step on the same Annotation bumps the version, so a chain of undos would fail its own check. The field check passes an equal value, which matches the Write Conflict rule that an equal Zotero value is no conflict.
- **Restore a deleted Annotation under its old key** (rejected): delete is an erase, and Zotero 10 refuses a client-supplied key on create. The re-created Annotation gets a new key, and the history renames the old key in every step, as Zotero's reader does.

## Consequences

- An undo of a delete, or a redo of a create, gives the Annotation a new Zotero key. Links in notes, excerpt images, and `obsidian://` URIs that name the old key no longer resolve. The app shows no notice for this; the docs page on annotation editing states it.
- An undo is a write: it needs the Editing Capability and is ignored while a write on the Attachment is pending or an Annotation the step touches has an open Annotation Draft.
- The history holds at most 100 steps and lives in memory only (ADR 0048).

The sidebar's undo and redo commands use the history of the Attachment its cards show. Edits from the cards and PDF view share that history. The repository decides whether a step applies and writes it, and the sidebar reports the outcome.

Ignore a second history key while a History Step is pending. The first undo must still finish and create its redo step. [History tests](../../../../packages/annotations/src/desktop/annot-view/atoms.test.ts)

The History Step and its stack update belong to the plugin lifetime. Closing a card view leaves the step running. [History command](../../../../packages/annotations/src/desktop/annot-view/atoms.ts)

Card undo and redo use the Attachment of the focused or selected card, with the sole Attachment as a fallback. On success the layout brings the changed card into view. When the step removed the Annotation, the PDF reader can land on its page. The repository reports a failed or blocked step through the same channels as other edits. An unloaded layout suppresses its own notice and scrolling even if the repository finishes the step. [Layout history](../../../../packages/annotations/src/desktop/annot-view/layout.tsx)

An Annotation View delete asks once before erasing. A PDF reader can erase a single selected mark immediately, and asks once for a group. A group confirmation names the count. A later undo creates a record under a new key, so it cannot restore references to the erased key. [Delete confirmation](../../../../packages/annotations/src/obsidian/annot-view/card-verbs.ts)

Only the card or an ordinary control in it can receive the Annotation History chords. A text editor keeps its own undo. Register the card chords through an Obsidian Scope catch-all because a keyed registration ends the lookup even when it takes no action. When the chord lands outside a card, the app can continue to the researcher's other command. Use the target's window for the DOM check and consume held-key repeats without stepping the history again. [Card history keys](../../../../packages/annotations/src/obsidian/annot-view/history.ts)

Use the active history surface for the palette and the bound PDF leaf for More options. Offer palette commands only when the surface can step the Attachment history. Keep the directions visible but disable unavailable entries in the PDF menu. Read menu availability when Obsidian raises `file-menu`. Use Obsidian's undo and redo icons, and leave global default shortcuts to Obsidian. A draft on the step's record can hide a command, but a momentary write does not hide it.

Share the history outcome message between the PDF and card surfaces. A lock refusal reports the Lock Reason. An Editing Capability refusal uses its own notice path so the same press cannot display two. A restore that makes the current user the record's creator reports that change. [History commands](../../../../packages/annotations/src/obsidian/annotation-repository/actions.ts) · [PDF menu](../../../../packages/annotations/src/obsidian/annotation-repository/menu.ts)

Keep one history while at least one PDF view holds it. Suppress a second press while a step or an Attachment write is running. Confirmations written by a history step do not record an extra step for the same Annotation. Other edits, including an autosave that becomes due during the step, still record. [History state](../../../../packages/annotations/src/obsidian/annotation-repository/core/state.ts)

A group recolour or delete records one history step from its confirmed results once the group settles. Carry the prior Lock Reason on a delete so a restore can explain the change in authorship. Send a history event separately from an Annotation list update so consumers can re-read step availability without replacing the list. [Repository model](../../../../packages/annotations/src/obsidian/annotation-repository/core/model.ts)

A group recolor or delete sends one request per Annotation and retains each outcome, including conflicts. The successful changes form one History Step. A Geometry Edit made with the keyboard keeps its nudge origin on conflict retry so it can join its run. A pointer gesture forms its own step. Restore includes the saved tags. The readiness query can show an available step while a momentary guard still blocks execution.

A split ink stroke contributes all of its successful creates to the same History Step. For grouped recolor and delete, gather successful outcomes in selection order after all requests settle. An error from one request leaves the other outcomes intact. An unrelated write that confirms during the group forms its own earlier step. History uses the Attachment's in-flight write count to guard undo and redo.

## Step identity and concurrent edits

Evict the oldest step when an Attachment reaches its history limit. Store a deleted Annotation's writable content because a restore cannot refer to an erased record. Restore the saved PDF position, Page Label, text, color, and tag types. Only writable positions support restore. A record without a saved color has no previous color to restore. Compare stored geometry using wire rounding and treat an absent string as equal to a cleared string. Compare a Geometry Edit's position, Sort Index, and Quoted Text together because the last two depend on the first.

A version refusal already supplies a reread. If that value matches the step's precondition, retry against the updated version. If it already matches the requested value, accept it without a conflict. An intervening value discards the step. A lock refuses the entire step before any request and leaves the step available.

Join keyboard Geometry Edits only when the current top step is on the same Annotation, comes from the same input, and the elapsed time from the last edit is less than 500 ms. Keep the first edit's starting value and the last edit's confirmed value. Grouped edits join by gesture ID and edit kind. An individual pointer drag stands alone. Clear redo on each newly confirmed change, including a joined edit or a text session that moves an existing step. Take a completed step out of its stack by identity so work recorded while it ran stays in the stack. Rewrite the restored key in both directions of history.

A text editing session groups saves across surfaces and keeps the original baseline. A session that returns to its starting text leaves no step. After an external change, an explicit retry starts a new step from the value Zotero held before that retry. An open draft on a step's target gives undo and redo to its editor. A pending Attachment write or armed autosave can prevent a history key from acting. The missed key is not queued for later execution. The integration tests advance the repository TestClock and wait for the autosave to finish before checking history. [History model](../../../../packages/annotations/src/obsidian/annotation-repository/history.ts) · [History tests](../../../../packages/annotations/src/obsidian/annotation-repository/service.history.test.ts)

The record of the top text step supplies the session baseline because each settled save can remove and recreate its draft. Join a save to that step when its field, record key and starting text agree with what the top step left. An intervening step of another kind or a changed value from Zotero starts a new step. Grouped records use the Card Selection order. A write that produced a different edit kind does not enter the group step and is logged. Restore suppression uses the Attachment because the new key is unknown before Zotero replies.

Check all group members against their expected values before sending any history write. After preflight, each write still uses the normal repository rules. A refusal after an earlier success can leave a partially applied step. [Issue 174](https://github.com/aidenlx/zotlit-repo/issues/174) tracks recovery. Remove an existence step before sending its writes because a restore rewrites the key in both stacks, which would replace the identity needed to remove the step later. [Step recording](../../../../packages/annotations/src/obsidian/annotation-repository/core/history-record.ts) · [Step execution](../../../../packages/annotations/src/obsidian/annotation-repository/core/history-steps.ts)

The Reader Keymap uses Command+Z and Command+Shift+Z on macOS. On Windows and Linux it uses Ctrl+Z, Ctrl+Shift+Z, and Ctrl+Y. Compare all modifiers and let native text controls keep their own history. A held key takes at most one step. Serialize Reader history presses through their landings. Once a step starts, view closure waits for its writes and stack update. Landing and notices can stop after the step settles. [Reader Keymap](../../../../packages/annotations/src/obsidian/pdf-annotation-editor/reader-keymap.ts) · [Reader operations](../../../../packages/annotations/src/obsidian/pdf-annotation-editor/operations.ts)

A view may close and the plugin may unload while a History Step awaits Zotero. Let the step settle and update the stacks. End any notice or landing on the retired view. Another Reader press waits for the preceding press, including its landing.

Take the Attachment list hold before opening its History so disposal closes the history before releasing the hold. The binding's history press completion includes the step and any landing it requested.

The keymap tests send the same chord inside and outside the editor. It takes text undo inside, and Annotation History outside.

Use explicit expected geometry and Sort Index values in history fixtures so tests verify read-back independently of the geometry code. Observe undo effects through the fake Zotero's saved record.

Close the last view of an Attachment before a case that needs
empty history, then reopen it. After undoing a resize, check
that Zotero restores the seeded position and Sort Index and
that the Reader lands on the changed Annotation.

[Paired resize history](../../../../packages/e2e/src/paired-run.e2e.ts)

### Paired history proof

Wait for ZotLit to read back its own write and close the
draft before requesting Undo. Zotero can answer before that
read, and an Undo during the pending write is rejected. For
consecutive history chords, send both before the first
response and verify Redo followed Undo. Check a complete
notice when fragments match several history outcomes. Drive
the Reader or card through its native Scope.

Undo of a range restores the seeded geometry, Sort Index,
and quote. Redo of the geometry uses its resulting range
quote. A comment session with several autosaves undoes as
one unit. Send a chord immediately after typing to verify
the focused editor uses text history before autosave. The
Reader leaves that chord to the editor and Zotero keeps the
last saved value. For a multi-tag edit, verify Undo restores
the original automatic tag type as well as the name.

[Paired history cases](../../../../packages/e2e/src/paired-run.e2e.ts)

Use disposable Annotations for delete history because Zotero
assigns a new key on restore. Wait for the reopened Reader's
Attachment read before creating, since that read binds its
database and makes creation available. Take the baseline per
case because other cases can have created records. Close the
new note's editor before invoking Annotation History so the
focused field cannot take the chord.

Redo of a delete acts on the restored key. Undo of a grouped
delete restores both records in one command, each with its
own new key. Wait for read-back so no pending write rejects
Undo. Use the PDF view Scope to avoid driving the sidebar
list during restores. Close any remaining confirmation as
Cancel during teardown. For quoted-text autosaves, Undo a
complete session and verify its seeded range and Sort Index.

[Paired restore and group history](../../../../packages/e2e/src/paired-run.e2e.ts)

Use two disposable records of different colors for grouped
color Undo. Wait for both writes and read-back before one
Undo through the PDF view Scope. Check that Zotero restores
both original colors. In a Literature Note with an embedded
Annotation View, the note's own focus gives Undo to its
editor. Observe that no write reaches Zotero. With a card
focused, the chord instead undoes its Annotation edit.

[Paired grouped and embedded history](../../../../packages/e2e/src/paired-run.e2e.ts)
