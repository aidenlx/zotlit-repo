# The Annotation View changes its Follow Mode only on a user gesture

An Annotation View instance shows the Attachment its Follow Mode selects: Active Tab, Zotero Reader, or Pinned. The user picks the mode from one toolbar button, the native pane menu, or a command, and the view keeps that mode until the user picks another. A source that cannot answer keeps the mode and shows its reason in place: Live updates off shows an empty state with a "Turn on live updates" action, a closed Zotero Reader keeps the last Attachment on screen under a "Zotero reader closed" line, and an active leaf that resolves to nothing shows the empty state. Unpin returns to the mode the view was in before the pin.

## Considered Options

- **Revert to Active Tab when the Zotero Reader source goes away** (the behaviour before this decision, rejected): the view changed what it followed with no gesture, so a user who turned the Local Server off found the list replaced by an unrelated note's annotations with nothing that said why.
- **Merge sources, last event wins** (rejected by the architecture decision behind Reader Session): two readers open on different Attachments would fight for the view.
- **Pin as a flag over a follow mode** (rejected): two visible states for one choice; the header could not name the mode in one word.
- **Explicit mode, held until the next gesture** (chosen).

## Consequences

- Pinned is one shape: an Item plus a remembered attachment choice. A pin taken from an Obsidian PDF view releases that view's attachment lock; the attachment line becomes a live picker that starts on the Attachment the PDF showed.
- Active Tab adds to the view only what the active leaf cannot show. With a Literature Note or an Obsidian PDF view in front, the Item title and creators stay hidden, and the attachment picker appears only when a note's Item has more than one attachment. Zotero Reader and Pinned show the identity block, because nothing else on screen names the Item.
- "Zotero reader closed" needs a Companion event the notify protocol does not carry today: `reader/inactive`, sent when the focused Zotero tab or window is no longer a reader. The Obsidian side keeps the last Reader Session target and flags it closed.
- Mode and pin persist in the view's workspace state, so each Annotation View instance keeps its own choice across restarts; no plugin setting holds a default.

## Amendment ([#1552](https://github.com/aidenlx/zotlit/issues/1552))

The Reading Card's "Open in the annotation view" is a user gesture that pins the sidebar to the card's Item. The sidebar stays pinned until the researcher unpins it.

Expose the same Follow Mode gestures in the view and command palette. Commands target the focused Annotation View, or the first open one, and appear only when the gesture applies. Give each command a unique ID and name because the host keys registration by ID. Returning from a non-file pane can reactivate the same note key, so activation and note identity are separate signals.

Save the workspace when a user gesture changes Follow Mode. On restore, keep a supported mode even if its source is temporarily unavailable. Fall back to the default for an unknown mode or a pin without an Item. Subscribe to the active PDF's Reader Session only while following Active Tab. Read the session from the view itself because two tabs can show the same file for different Attachments. Zotero Reader follow needs live updates and can offer to turn them on.

Pinning from a PDF releases the Attachment lock and preserves the active choice for the Item. Prefer the bound Attachment, then the stored choice, then the first available Attachment. A mode change clears Card Selection before the new reader publishes its own. Revealing an Annotation acts on the current list. An explicit pin from the Reading Card is a Follow Mode gesture.

The pane menu reuses the header menu's groups. It adds the Query View controls and puts the less frequent Refresh data action in the pane menu. Refresh remains a user gesture when the source stops answering. [Pane menu](../../../../packages/annotations/src/desktop/annot-view/pane-menu.ts)

Pinning the current Item releases the bound PDF lock. Unpinning returns to the prior Follow Mode. The user can enable Live updates so reader updates reach the view. [Follow Mode actions](../../../../packages/annotations/src/desktop/annot-view/actions.tsx)

Pin an Item with its remembered Attachment choice. A standalone Attachment can show without an Item, so in that state offer the Item picker instead of pinning the current view. Keep the current pin when its Item cannot resolve, and give that state its own message. The header menu reports Pinned as the current mode and offers pin or unpin actions separately. An existing ZotLit PDF Reader already identifies its locked Attachment. For a lock held by the Zotero Reader, show the Attachment and who holds the choice. Offer a picker when more than one Attachment can be chosen. [View presentation](../../../../packages/annotations/src/obsidian/annot-view/presentation.ts)

## Resolve and restore a Follow Mode

Resolve a note by the Item Indexed Key in its frontmatter. A bound reader supplies the locked Attachment and uses its parent Item to name the Attachment list. Resolve a standalone Attachment by its own key. Translate a group ID through the active Library list. The view passes these inputs to a pure resolver so branch tests can exercise the decisions without Obsidian or a database.

Restore the workspace's mode and pin when they parse. Accept the former mode names and `linkedIndexedKey` for linked pins. Use Active Tab for unreadable state and for a pin without a usable key. Preserve a recognizable pin if its source cannot currently resolve. Record the mode a pin interrupted so Unpin can restore it. Workspace state can also carry the sidebar's Query File text for Sort, Group by and filter. [Target resolver](../../../../packages/annotations/src/obsidian/annot-view/resolve-target.ts) · [Workspace state](../../../../packages/annotations/src/obsidian/annot-view/view-state.ts)

### Follow Mode menu proof

Check the order of the two Follow Modes and check other rows by
presence because an unavailable pin adds a reason row. Each entry
must fit inside the popup. Verify horizontal overlap with the
trigger because Obsidian can align either edge to avoid overflow.
Press the same trigger again and verify the menu closes. Its
dismissal must finish without reopening the same menu.

[Follow Mode case](../../../../packages/e2e/src/follow-mode.e2e.ts)

### Item change proof

Hold worker requests and sample both rendered frames and DOM
mutations while following a different Literature Note or pinning a
different Item. Keep the old Item and its cards intact until the new
snapshot is ready. A read that takes more than 150 ms can show the
new title with a loading body. A title never appears over another
Item's cards. For the pin gesture, wait until the picker has settled
on the typed answer and select by Indexed Key because titles can
repeat.

[Item switch cases](../../../../packages/e2e/src/library-view-navigation.e2e.ts)
