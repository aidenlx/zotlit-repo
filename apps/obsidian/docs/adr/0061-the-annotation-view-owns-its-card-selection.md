# The Annotation View owns its Card Selection; a bound reader is kept in step

Each Annotation View instance holds its own Card Selection: none, one, or several Annotation Cards, in every Follow Mode. A card click changes the view first. The reader the Follow Mode follows is kept in step with it: an Obsidian PDF view both ways, the Zotero Reader into the view only. This reverses the model of [#1146](https://github.com/aidenlx/zotlit/issues/1146) and [#1148](https://github.com/aidenlx/zotlit/issues/1148), where the reader owned the selection and the view mirrored it.

Under the mirror, a card could be selected only while an Obsidian PDF view was bound. Pinned, the Zotero Reader, and a Literature Note tab selected nothing, so no card-level control could depend on selection. Explicit edit controls ([ADR 0060](0060-card-text-is-edited-only-through-explicit-controls.md)) and group verbs both need a selection that exists without a reader.

## Considered Options

- **The reader owns the selection and the view mirrors it** (the [#1146](https://github.com/aidenlx/zotlit/issues/1146)/#1148 model, rejected): no selection without an Obsidian PDF view, and the Zotero Reader cannot take a selection from ZotLit ([ADR 0036](0036-local-api-enablement-is-a-guided-manual-step-in-zotero.md)), so its mode could never select.
- **The view owns the selection with no reader link** (rejected): the PDF and the list would disagree about what is selected, and a mark click would no longer find its card.
- **The view owns the selection; the bound reader is kept in step** (chosen): the view works alone, and a bound reader stays in step with it.

## Consequences

- A card click in the view changes the Card Selection. With an Obsidian PDF view bound, the reader lands quietly on the mark (a Mark Landing, no Mark Popup).
- A selection change reported by the bound reader, a clear included, replaces the Card Selection. So does each Zotero Reader push. While an editor is open on a card, the change waits and the latest reader state applies when the editor closes.
- A Follow Mode change or an Attachment change clears the Card Selection. A filter change drops the cards it hides. A deleted Annotation leaves it. Nothing persists.
- A card opens its full text and offers edit controls only when it is selected alone. A card selected with others offers neither, as in Zotero's own sidebar, so no card is "primary".
- Pinned and a Literature Note tab bind no reader. Two views bound to the same Obsidian PDF view share a selection through that reader.
- Multi-selection uses Zotero's gestures: Cmd/Ctrl-click toggles a card, Shift-click takes a range in list order, and Cmd/Ctrl+A takes every visible card. Keys go through the view's `Scope`.

## Amendment: a card in a group keeps its tag control

Accepted 2026-09-25, revised 2026-09-26 by [#1241](https://github.com/aidenlx/zotlit/issues/1241). A card selected with others stays compact, but it still shows its tag control. A press on it first selects that card alone, then opens its editor, so an editor never opens on a card in a group. Only on a card selected alone is the comment an editable field ([ADR 0066](0066-the-comment-is-an-editable-field-on-a-card-selected-alone-and-in-the-mark-popup.md)).

## Amendment: a blur saves the card comment editor and keeps it open

Accepted 2026-09-25. A blur saves the card's comment editor and keeps it open, as Ctrl/Cmd+Enter does; Escape or a view gesture that changes the Card Selection saves and closes it, and a reader selection change waits until then. The card's tag editor follows the same rule: a blur ends the tag editing session with its one write and keeps the editor open for the next session, as the amendment to [ADR 0063](0063-annotation-tags-save-once-per-editing-session-and-merge-by-name.md) decides.

## Amendment: the card list is a grid of rows

Accepted 2026-09-25. The list is a multi-select `grid` of `row`s that carry `aria-selected`, not a `listbox`, because each card holds controls and a `listbox` option cannot.

## Amendment: a collapsed group drops the cards it hides

Accepted 2026-10-15 by [#1497](https://github.com/aidenlx/zotlit/issues/1497). The Card Selection holds only cards the list draws. A group collapse drops the cards it hides from the Card Selection, as a filter change does, so Delete and copy act only on cards in view. A reader selection or a reveal of a card that shows only in a collapsed group selects nothing. The bound Obsidian PDF view follows the smaller selection. A card shown under two group headings is one Selected Card at two Card Places; ↑ and ↓ step through the places in the order the list draws them.

Each grid row contains one cell. Keep Tab access on the current row and its controls. When a filter hides the anchor, move the Tab stop to a surviving selected row, or to the first remaining row when the filter hides the whole selection. Range selection collects Annotation keys once even when a card has multiple Card Places. At the list boundary, let an unhandled arrow key scroll. [Grid tests](../../../../packages/annotations/src/desktop/annot-view/AnnotView.test.ts) · [Layout tests](../../../../packages/annotations/src/desktop/annot-view/layout.test.ts)

Expose the card grid as one column of rows in list order even when it draws multiple visual tracks. Give the grid a hidden accessible name so Obsidian does not show a tooltip across the list. A group toggle takes its name from the heading's text. [Annotation View grid](../../../../packages/annotations/src/desktop/annot-view/AnnotView.tsx)

## Keyboard ownership and reader synchronization

The host supplies the Obsidian Scope for the cards and decides which parts of its frame act as the list. Text fields and composite widgets own their own keys. Native menus have a separate Scope. Escape leaves a text field to handle the key, or closes a card editor before clearing selection. When neither action applies, the host can handle Escape. Up and Down move in row order and focus the resulting card. Shift extends from the anchor. Keys that move nothing remain available for scrolling. Delete and Backspace both erase the selection when the list owns the key because some Mac keyboards use Backspace for the key labeled Delete. Number keys use the PDF palette order. Select All and Copy work across the host, with ordinary text selection keeping the platform Copy behavior.

Apply the bound reader's latest selection after the card editor closes. Apply available keys and retry the reader's current selection when a missing key loads. Ignore the immediate echo of a selection the layout just sent so it keeps the Card Selection anchor and focus. Loading alone does not prune cards. When a filter, group change, or list update hides selected cards, prune them and share the reduced selection through the bound ZotLit PDF Reader, except while the reader has a selection waiting. Showing a pruned card again does not restore its selection.

A plain click, a modifier click that adds a card, and an arrow move land quietly on the selected mark. Removing a card or extending a range repaints the marks. A group key can contain arbitrary characters, so locate a Card Place by comparing its identity instead of interpolating it into a CSS selector. [Layout selection](../../../../packages/annotations/src/desktop/annot-view/layout.tsx)

An action on a card inside a multi-selection uses the group. An action on a card outside it first selects that card alone. Copy Selected Cards as plain text. [Card actions](../../../../packages/annotations/src/desktop/annot-view/actions.tsx)

Focus a clicked row without scrolling it so card history shortcuts have a target. Shift-click extends Card Selection without selecting page text. Leave Shift-click and the context menu to text fields. A press inside a control belongs to that control, including menu actions and tag filter toggles. [Card gestures](../../../../packages/annotations/src/desktop/annot-view/Annotation.tsx)

The Annotation View and the PDF reader share plain-text copy. Preserve the order of the cards and leave the clipboard alone when there is no text. [Copy action](../../../../packages/annotations/src/obsidian/annot-view/card-verbs.ts)

Use the same filtered, grouped order for keyboard selection and the rendered grid. A card contributes a place per visible group. Cache that order by the list and filter and grouping inputs because the selection subscription reads it on every store update. [Visible order](../../../../packages/annotations/src/obsidian/annot-view/state.ts)

Copy uses the excerpt when present and plain comment text otherwise. Skip cards without either, and separate copied cards by blank lines in list order.

Keep controls in other rows out of sequential Tab navigation while leaving them reachable by a pointer. One observer covers controls from both Preact and native panels, including controls inserted after the grid mounts. Save the renderer's current `tabindex` while the control is held out of the order, and restore it when the row gains the Tab stop or the observer is disposed. [Shared copy](../../../../packages/annotations/src/obsidian/annot-view/copied-text.ts) · [Tab order](../../../../packages/annotations/src/obsidian/annot-view/tab-order.ts)

Selection uses Indexed Keys to keep one record selected when it appears in several Card Places. Movement starts at the visible focus, then the visible anchor, then the first visible Selected Card. When there is no origin, Down enters at the first place and Up at the last. A prune can leave the old anchor in state, but a range starts from a visible origin, so it cannot include extra cards based on a hidden anchor. A reader replacement takes cards in list order and sets the anchor and focus on the first matching place. A transition with no effective change returns the current state by identity. [Selection transitions](../../../../packages/annotations/src/core/annot-view/card-selection.ts)

The Annotation View can send a multi-selection to the Reader. The Reader's up and down actions start from its first mark in reading order and reduce the result to a single mark. A landing requested on a different mark selects that mark alone.

A press on an external selection driver such as an Annotation Card preserves the Reader selection until the driver's own click supplies an update. A Card Selection enters quietly. A group paints the marks without a Mark Popup or handles.

When a read removes selected records, reduce the group to its surviving members in the same update. If one survives, select it quietly. If none survives, clear the selection.

A Consumer Card Selection passes through the Reader selection handler. The handler paints it and reports it through the Reader Session without opening the selection popup.

### Rendered interaction proof

Wait for the excerpt height to settle before measuring a card's
selection transition. Seek the actual transitions to their midpoint
so a late timer cannot sample the endpoint. With reduced motion,
expect the final values without transitions. Check the rendered
focus stops to verify the header is one press target separate from
More options. Use accessible labels for controls and verify they
do not carry extra title tooltips over the native ones.

[Annotation View interaction cases](../../../../packages/e2e/src/annotations.e2e.ts)

For grouped cards, drive the native Scope with the focused card
as target. Arrow keys skip a collapsed group. Folding a selected
card away clears that selection so Delete cannot affect a hidden
Annotation. When an Annotation appears under multiple tags, each
rendered occurrence has a separate navigation position.

[Grouped card navigation](../../../../packages/e2e/src/query-view.e2e.ts)

### Paired selection proof

Start with a fresh Reader binding. Pinned mode has no bound
Reader and therefore changes no PDF selection. Return to
following the active PDF for shared selection. A Mark click
replaces the card selection. In the focused search field,
Down belongs to the field. Send Escape and Delete from the
active view through its Scope.

A modifier click on comment text adds or removes the card
without editing the text. A plain click selects it alone.
Read range endpoints from live row order because an earlier
case can add a row between the fixtures. A range extends
from the last anchor. Removing the last selected card keeps
that anchor through the reader's echo. Adding a card can
land on another page, while deselecting it only repaints.
A multi-delete confirmation reports the count and waits
before deleting.

[Paired selection cases](../../../../packages/e2e/src/paired-card-selection.e2e.ts)

In the paired selection proof, use Obsidian's DOM menu and
Scope for actions on the focused card, and the vault's
in-memory clipboard for copied text. When the Zotero Reader
selects several records, show cards in list order. Clearing
that Reader selection clears the Card Selection.

[Paired selection and copy cases](../../../../packages/e2e/src/paired-card-selection.e2e.ts)
