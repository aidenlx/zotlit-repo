# Annotation Tags save once per editing session and merge by name

The saving state below is superseded by [ADR 0064](0064-surfaces-draw-pending-proposals-from-query-core-mutation-variables.md): the tag editor closes at once onto the session's merged tags, drawn as a Pending Proposal until the save settles. This takes the rejected option "Close at once and draw the draft chips as pending".

Decided in the Annotation Tags grilling (2026-09-25). A tag editing session starts when the tag editor opens inline, from the Annotation Card's tag toggle or the Mark Popup's tag verb. A click on the tags themselves opens no editor, so both surfaces start a session through the same explicit control. It ends when the editor closes, on blur or Escape. Blur and the tag toggle add the text that is typed but not yet added. Escape ends the session without that text. During the session the Annotation Draft holds the tags the session started from and the current tags, so the Annotation View and the Mark Popup show the same draft. Enter adds the typed name, a comma is an ordinary character because a Zotero tag name can contain one, and an exact, case-sensitive duplicate is ignored.

At close, the repository sends one Local API write. It applies the session's added and removed names to the Annotation's current confirmed tags and sends the whole list, because Zotero replaces the list. A kept tag keeps its type, a new tag is manual, and an automatic tag can be removed, as in Zotero. Tags never raise a Write Conflict: a tag that Zotero added or removed during the session stays in the merged list, and a precondition failure re-reads the Annotation and applies the same names again, once. A second precondition failure holds the draft as a failed save. A tag save is therefore a pending write but not a `ConflictedWrite`. This follows the Write Conflict rule that a Zotero value already equal to the intended one is no conflict, applied per name.

One session is one History Step. Its undo is the reverse of the merge: it removes the names the session added and adds back the names it removed, with their old types, against the current tags. This replaces, for tags alone, [ADR 0059](0059-annotation-history-is-per-attachment-checked-by-field-value-and-restores-under-a-new-key.md)'s check that the step's after values still equal the confirmed record.

While the write is in flight, the editor stays open in a saving state with its input and remove buttons disabled. It closes onto the confirmed chips when the read-back arrives. The card and the popup therefore keep [ADR 0048](0048-annotation-drafts-and-pending-writes-stay-in-memory.md)'s rule of confirmed data while pending, and the chips do not switch back to the old tags for a moment. The verbs do not stand down for the session's save, because the editor already shows it. A tag undo or redo is a gesture's write, so it stands the verbs down and shows pending, as other undo writes do.

The tag draft follows ADR 0048's comment rules for authorization and failure, as [ADR 0062](0062-editing-requires-a-remembered-authorization-and-allow-leaves-zotlit-read-only.md) leaves them. If editing becomes unavailable while the editor is open, or Zotero refuses the save, or the response is lost, the draft is held with the same reason lines as a comment draft. The researcher selects **Save tags** before automatic saving resumes.

## Considered Options

- **A write for each added or removed chip, as in Zotero's tag box** (rejected): each chip is a pending write, a History Step, and a possible conflict, and the card shows a saving state after every chip.
- **Autosave on a typing pause, as for a comment** (rejected): tags are discrete, so there is no typing burst to protect.
- **Compare the whole list and show the conflict panel** (rejected): it asks the user to pick between two lists that merge without loss.
- **Close at once and draw the draft chips as pending** (rejected): it breaks ADR 0048's rule of confirmed data while pending. Closing at once and drawing the confirmed chips makes them flicker.

## Consequences

- While the Editing Capability is off, the card's tag toggle follows the comment toggle: it stays pressable and dimmed, and a press shows the capability notice with the reason. The Mark Popup's tag verb is disabled with the reason in its tooltip, as the popup's other editing verbs are. Both follow [ADR 0047](0047-annotation-reading-is-continuous-and-editing-is-an-added-capability.md). The chips still show, and a chip click still toggles the Annotation Filter.
- A card whose new tags no longer satisfy the Annotation Filter leaves the list when the save is confirmed.
- In the Mark Popup, a session also ends on the tag verb's second press, when the selection moves to another mark, when the popup hides, and when the editor unmounts, as it does when the PDF view closes. Each end saves the session once. The tag editor and the comment editor are mutually exclusive in the Mark Popup: opening one closes the other, and the comment editor stores its text first.
- The creation Mark Popup has no tag verb. The popup reopens on the new mark, where tags can be added. Tags in the create request can come later without a change to this model.
- Tag names are suggested from the tags of the Annotation's Library.
- The Template Workbench's chip input now uses the same shared tags input. It ignores an exact duplicate, and it trims a suggestion that it accepts.

## Amendment: on the card, a blur saves the tag session and keeps the editor open

Accepted 2026-09-26 ([#1237](https://github.com/aidenlx/zotlit/issues/1237)). On the Annotation Card, a blur ends the tag editing session with its one write, and the typed text is added first. The tag editor stays open, as the card's comment editor does on blur ([ADR 0061](0061-the-annotation-view-owns-its-card-selection.md)). While the save is in flight, the tag field keeps the caret but is read-only, and a blur starts no second save. The next change starts a new session, which is its own History Step. Escape, a second press on the tag control, or a view gesture that changes the Card Selection ends the session and closes the editor. The Mark Popup keeps the session ends above: there, a blur ends the session and closes the editor.

The tag control is the entry point for the card's tag editor. The editor keeps its Scope while focus moves between the input and the chip controls, and restores that Scope when focus returns. Escape during an input method composition belongs to the input method. Unmounting saves the tag session without closing a replacement editor. [Card editor tests](../../../../packages/annotations/src/desktop/annot-view/Annotation.test.ts)

Select the card alone and close its current editor before opening the tag editor. Reopen an existing tag draft when available. Offer names from the Annotation's Library. If a draft requires explicit Save tags, an automatic close leaves the draft available for that gesture. Discard keeps the saved tags from Zotero. [Card tag actions](../../../../packages/annotations/src/desktop/annot-view/actions.tsx)

When the tag toggle closes an open editor, retain focus through pointer down so blur does not save ahead of the toggle's own save. Render the comment and tag editing targets together so a change replaces the tag editor and ends its session before the comment editor takes focus. Give the newly mounted tag editor its own click callback. Preact stamps the callback with its attachment time, and sharing the action bar's callback could stop the action bar from claiming the click that opened the editor.

When editing becomes unavailable, render held tags with their explicit save action. Compare held-panel values so an equivalent snapshot leaves the panel in place. Display draft tags on the card when a draft exists. The filter still reads the saved tags. A tag chip toggles its filter and shows whether the tag is selected. [Card tag controls](../../../../packages/annotations/src/desktop/annot-view/Annotation.tsx)

The card and Mark Popup display the current tag draft during editing and after a failure. A pending tag write draws the record's Pending Proposal. Save tags belongs to a changed, held draft after the session ends. An open session, a pending save and an unchanged session need no held panel. [Tag controls](../../../../packages/annotations/src/obsidian/annot-view/card-controls.ts)

## Tag input lifetime

Use the card's tag chips and mark automatic tags. Load Library names once when the tag input mounts. The native suggestion popup answers synchronously from the names it has. Put the typed name first unless the draft already contains it, exclude existing names, and add one name on Enter even if it includes a comma. Keep the popup in the editor's own interaction boundary when it extends outside the editor.

The tag editor owns Escape while focus is within the field or its chip controls. The suggestion popup can use its own higher Scope. Moving focus within the editor or the owner-provided boundary keeps the session open. Preserve field focus on chip presses so they neither save the draft nor select a card.

When focus leaves or the editor unmounts, add any remaining input before submitting the session. Escape ends the session without adding that text. Ignore late suggestion picks after close. A surface can save on blur and leave the editor open for the next session. If the previous session is still saving, that blur adds no save. Stash the latest callbacks for the popup and focus listener, which outlive an individual render. [Tag editor](../../../../packages/annotations/src/obsidian/annot-view/tag-editor.tsx)

Both sources expose Tag names and types. Keep the types during a write and treat a record with only names as manual Tags. Template metadata preserves missing facts as unknown. An open tag session keeps its starting names and current names. A session save differs from a tag history write. Show the explicit Save tags action only after a session ends with a draft still held. [Repository model](../../../../packages/annotations/src/obsidian/annotation-repository/core/model.ts)

A tag save sends the full list because Zotero replaces the field rather than patching individual entries. Compare names case-sensitively. Keep Zotero's numeric tag types, including new values, when merging existing tags or restoring typed tags from history. New names and records without type information use the manual tag type. An unchanged session ends without a write. The paired Local API probe returned HTTP 204 and stored the submitted list exactly.

If Zotero rejects the first tag save on the version precondition, read the current Annotation and apply the same name changes to its fresh tags once. The second send tracks its own reply.

Hold a changed tag draft for explicit save when editing becomes unavailable. Allow an existing editor to add its final typed name as it closes. Reauthorization alone sends nothing. Keep a saving session's draft stable until its result arrives. An explicit retry after a lost reply merges the names into the current Zotero list, including when the previous attempt already took effect. A successful save lifts the hold for the next session.

A tag session contributes one independent History Step. Undo and redo reverse its additions and removals against the list Zotero holds, retaining unrelated changes and the tag types carried by the step. If a version refusal supplies newer tags, rebuild the request from that list.

Compare the confirmed records around a tag save to record its actual name changes. A save that leaves the existing names produces no step. A tag undo whose target list already stands takes the step without a write.

Use the explicit save path for Save tags on a held panel. Ending a session through blur adds the typed name. Escape leaves it out.

Show the popup tag section when the record or draft has tags, while an editor is open, or while a draft is held. On losing editing availability, close the editor and keep its changes for explicit save. Read automatic tag types once per record because an unknown type logs.

In the tag wire harness, patch replaces the entire tag list and a version mismatch produces 412, as in the paired probe. The fake response includes an explicit tag type for automatic tags.

### Paired tag proof

Use a disposable Annotation to check that Zotero replaces
the full tag list. Send each tag with the correct type
semantics. Test stale versions in the body and header. Both
refuse with the stored and submitted versions, leave tags
unchanged, and omit Last-Modified-Version.

In the card and Mark Popup, use the toggle to end the edit
session because a background window may not deliver focus
events. Check that no write lands while the session stays
open and that pending typed text is included at the end.
Observe the row through save and read-back to catch a frame
with neither editor nor confirmed chips. If a seeded Mark
shares the click point, step to the created one before
checking the popup.

[Paired session cases](../../../../packages/e2e/src/paired-annotation-sync.e2e.ts)

Send focus events explicitly in the paired session case because
a background window may not deliver them. Blur saves the first
session while keeping the editor open. Refocus begins a later
session, which Escape saves and closes. Undo each session in
reverse order.

[Blur and session cases](../../../../packages/e2e/src/paired-annotation-history.e2e.ts)

Compare tags by name and type because a manual and automatic
tag can share visible text. The card and popup share the
inline editor and its gesture helpers. Find an automatic
chip by its name because it also carries a type label.

[Paired tag helpers](../../../../packages/e2e/src/paired-run-fixture.ts)
