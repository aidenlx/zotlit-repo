# The Mark Popup is one Preact root on Obsidian's popover

Supersedes the Mark Popup parts of [ADR 0042](0042-the-surfaces-inside-the-pdf-reader-are-vanilla-dom-on-obsidians-popover.md), including its amendment "the Mark Popup's tag section is a Preact island", and the Mark Popup part of the rejected option "A Preact root with signals or a store hook" in [ADR 0056](0056-reader-surface-state-is-one-vanilla-store-per-pdf-view.md). The Annotation Marks and the Creation Toolbar stay vanilla DOM, as those ADRs decide.

Decided on 2026-09-26. The Mark Popup had grown from a row of verbs into the row, the rendered comment, the comment sheet, the held-draft and Write Conflict panels, and the tag section, and the Annotation Card draws the same parts as a Preact tree. The vanilla popup emptied its row on every refresh and rebuilt most of its column, so the node under the pointer, the focused verb, and the colour verb a menu hangs from were replaced mid-gesture. It kept its own workarounds against that: a rendered-comment frame moved between rebuilt columns, a tag root moved the same way, and a hand-written split between a refresh and a rebuild.

The Mark Popup stays Obsidian's `HoverPopover` on the plugin's popout-aware base, with the same virtual anchor, pinning, dismissal, and hover parent. Its content element carries `.zt-root` and one Preact root, created as the popup opens and unmounted as it hides. The Mark Popup Host keeps its store subscription and its row filter, and on each change that passes the filter it renders the variant's element synchronously and then positions the popup; the components are pure functions of their props, with no store subscription of their own. The element is keyed by the floating kind and the Annotation, so another Annotation mounts anew and every other change is a diff in place. The popup also watches its content and centres again when it resizes, which covers a comment whose Markdown renders after the popup measured itself.

## Considered Options

- **Keep the vanilla popup and patch each fault** (rejected): each fault needs its own guard — keep the verb nodes, keep the menu's trigger, keep focus — beside the workarounds already there, and the card's Preact wrappers stay a second copy of the same parts.
- **Components subscribe to the Reader Surface State** (rejected): renders become granular, but a store-driven render is queued, not synchronous. The host measures the row's width right after a refresh to centre the popup, and the controller tests read the popup's DOM on the line after a gesture; both would need a deferred measure and awaits.
- **One root, rendered by the host** (chosen): a render commits in the same call, so the host's refresh-then-position order and the synchronous tests hold, and the diff keeps every node that did not change.

## Consequences

- The comment sheet, the rendered comment, the held-draft panel and the Write Conflict panel are shared Preact components that both the Annotation Card and the Mark Popup render. The vanilla builders stay inside them, and each redraws only when what it shows changes.
- The popup's controls are the shared Preact `IconButton`. A blocked control keeps its seat, its place in the tab order, and its reason in the tooltip. A control's colour travels as `--zt-verb-color` in its style and is applied to its glyph, because Obsidian declares a `clickable-icon`'s own colour unlayered.
- The comment sheet and the tag editor are owned by their components. The controller keeps ref handles for the calls it makes: reading the sheet's text, ending the tag session, and testing whether a press belongs to the tag section or its suggestion popup. Owners still end a session before the host renders; a render that a session's end sets off runs after the render in progress.
- The theme hooks keep their names and places: `zt-pdf-mark-popup`, `data-zt-verb`, `zt-pdf-comment-sheet`, and `data-zt-section="tags"`.
- The reader rule becomes: the Mark Popup is the one reader surface that imports Preact.

## Amendment: the selected-mode row has no comment verb

Accepted 2026-09-26 ([#1242](https://github.com/aidenlx/zotlit/issues/1242)), revised by [ADR 0066](0066-the-comment-is-an-editable-field-on-a-card-selected-alone-and-in-the-mark-popup.md). The comment under the popup's row is an editable field, as on an Annotation Card selected alone: a click on it, or on "Add a comment…" where there is none, is the one way into the popup's comment editor. So the selected-mode row no longer carries `data-zt-verb="comment"`; the field carries `zt-annot-comment-field`. The creation row keeps its `data-zt-verb="comment"`. Every other theme hook above keeps its name and place.

## Popup width and visibility

The mark popup overrides Obsidian's hover-popover child width at the
host rule's specificity. The action row determines the popup width.
The comment sheet and the comment slot use a minimum width for editing
and allow their contents to fit the row. The slot applies the width
override to the shared sheet and held-draft builders in `editor-sheet.ts`
without changing their layout in the Annotation Card. When another tab
covers the view, the popup hides through its covered attribute and
remains mounted so it can restore the typed comment when the view shows
again.

Treat presses in the Mark Popup, its tag suggestion popup and delegated selection surfaces as inside the interaction. Recompute the popup anchor on scrolling and repaint. An offscreen mark can keep its selection without a popup. Repeated clicks over overlapping marks retarget the same popup through the stack. Keep the row and held draft controls mounted across equivalent updates because the browser uses the shared press and release target for the click. Obsidian can close a menu if its trigger leaves the document.

Close the editor when its selection episode ends. End a tag session before submitting it and ignore a delayed edit when both its session and draft have gone. Escape outside the tag field closes that editor before clearing the selection. During a drag, Escape cancels the adjustment before clearing the selection. Toggling tags submits the comment editor's text first. The comment sheet places the caret on mount, using the click point once and the end on a later mount. A move to a verb on its own row stays within the editor. The popup edits the shared draft in place and revealing the card leaves its editors as they are. [Mark Selection](../../../../packages/annotations/src/obsidian/pdf-annotation-editor/selection.ts)

Taking focus for the create-mode comment sheet can collapse the browser selection. Use geometry already captured at release. Keep comment text across popup renders. Closing its selection episode releases the sheet's keys and prevents a late commit from reading its old text.

The comment and tag editors are mutually exclusive. Image capture, a Text Draft and a selected group do not use the Mark Popup.

## Position, visibility, and refresh

The variant owners supply current anchor geometry and content. Use a virtual point because a PDF page repaint replaces any mark node available as a target. Pin the popup with focus state and show it immediately because the create gesture's trailing click can dismiss a popup still waiting to show. Use the binding as hover parent to keep Obsidian's Page Preview separate. Mount the container before drawing the first editor so it can take focus. Position once to attach it to the document, then center over the point after measurement and apply Obsidian's viewport clamp. Reposition on content resize with an observer from the current window.

Retarget on scroll or paint without rendering the row. When both are needed, redraw before measuring width. Hide during a held Mark Handle adjustment and rehang on release. Hide a covered PDF's popup while keeping its editor mounted. When the cover lifts, draw the latest state, including any new selection made by a write that settled while covered. A missing anchor hides the popup and lets the variant decide whether its selection can stay. Presses in a menu opened by the popup belong to that interaction.

Store the popup before mounting it and clear its reference before unmounting. Session changes triggered during a render can request another refresh or dismiss the popup. Run any refresh after the current diff and check that the root remains mounted before rendering. The content key uses the variant kind and selected Annotation, so an equivalent update preserves the focused control and the node under a press. The comment slot owns width across editor states and the row stays centered. [Popup host](../../../../packages/annotations/src/obsidian/pdf-annotation-editor/mark-popup-host.ts) · [Popup](../../../../packages/annotations/src/obsidian/pdf-annotation-editor/mark-popup.tsx) · [Popup host tests](../../../../packages/annotations/src/obsidian/pdf-annotation-editor/mark-popup-host.test.ts)

Copy and reveal remain available because they do not write to Zotero. Color, tags, delete and comment use the Annotation Card's capability and write rules. A blocked verb keeps its tab order, accessible state, and reason tooltip. Use the pressed control as the menu anchor for keyboard and pointer activation. Assign the palette color to its glyph because Obsidian's unlayered control style wins over a color utility on the button. The stepper cycles overlapping marks. Add tags after creation, when the selected mark's popup replaces the create popup.

Recompute the popup anchor after repaint because PDF.js can replace the target geometry. Subscribe the editor owners before the popup host so they release an editor before its popup redraws or hides.

The create variant shares the popup host and offers copy during a blocked create. A swatch ID follows its position in the shared palette so a keyboard shortcut names the same color when a row shows only some swatches. Use highlight for a color commit unless a selection tool is armed. Align the tag section with the comment and keep its suggestions within the interaction even when their popup extends outside. Resting chips display names without applying a filter.

### Paired selection and tab changes

Drive the press, browser selection, and release to open the
create popup. Pressing outside discards the waiting selection
and draft without writing. After a real Highlight click, wait
for the new mark and its selected popup and let write-related
reads finish. Switch tabs and check that the tab change alone
hides the popup. Returning to the PDF retains the highlight
selection. A newly opened tab can become the most recent
leaf before its active-leaf notification places the popup.

Check that a pending comment stays as entered when revisiting
the PDF. Escape closes the editor first and then the selection,
with no write for a cancelled draft.

[Paired popup cases](../../../../packages/e2e/src/paired-mark-handles.e2e.ts)
