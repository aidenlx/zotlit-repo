# The comment is an editable field on a card selected alone and in the Mark Popup

Supersedes [ADR 0060](0060-card-text-is-edited-only-through-explicit-controls.md).

On a card selected alone, and in the Mark Popup, the comment is an editable field: a click puts the caret where it lands, and an empty comment shows "Add a comment…" as the field's placeholder. A click on a card that is not selected alone only selects it, so a long list stays safe to read. The editor saves as the user types and ends on Escape, on a click elsewhere in the view, or on a change of Card Selection; it has no Done button. The Quoted Text is edited through "Edit quoted text": a pencil at the end of the quote's first line, which shows while the pointer is over the quote or the keyboard is in the card, and the same item in the card's menus. A click on the quote itself only reads, selects, and copies. This is the split Zotero's own reader makes, which is the habit ZotLit's researchers already have; the pencil is the one Obsidian shows over a rendered block it can edit.

ADR 0060 gave each field an explicit control — a pencil in a gutter beside the comment, "Edit text" in the header — and a Done button to leave. Built, that put three "stop editing" signals around one short field (a form ring, a pressed pencil, and a call-to-action button), a gutter that narrowed every selected comment, and a header glyph that non-technical users did not recognise. ADR 0060's two concerns are met another way: typing is the only thing that changes text, so selecting and copying in the field stay safe; and the placeholder, a hover fill, and the text cursor show that the field is editable. A comment's Markdown shows as its source while the field is open.

## Considered Options

- **Explicit controls with Done** (ADR 0060, rejected): visible, but verbose; the controls cost more attention than the edit.
- **Hybrid: the comment field plus a pencil shown on hover** (rejected): two ways in for one field. The Quoted Text keeps a hover pencil because a click on the quote stays a read, so the pencil is its one visible way in, and it takes the end of the first line rather than a gutter.
- **Quoted Text through the menus alone** (rejected once built): nothing on the card said that the quote could be corrected.
- **Quoted Text click-to-edit like the comment** (rejected): the quote is copied often and corrected rarely, so a click on it keeps reading and copying.

## Consequences

- While editing is blocked, the comment stays rendered text with no hover fill, and a click shows the notice that says why. A held draft's text follows the same rule.
- The open field has an accent hairline at its start edge. The tint is also the resting field's hover, and it is too faint to mark the focus alone.
- The creation Mark Popup keeps one primary button, named for what it creates (**Highlight** or **Underline**), because creation is a commit the user must see.
- A held draft continues with a click on its text, the same gesture as a comment with no draft.

Place the caret from the pointer coordinates when a click opens the editor. Escape restores focus to the card. Use a separate accessible label for the field because Obsidian displays an element's `aria-label` as a pointer tooltip. Treat a drag that starts in the field as a field gesture even if it ends outside it. The card list's own empty-space action closes the editor before it clears the selection. [Card tests](../../../../packages/annotations/src/desktop/annot-view/Annotation.test.ts) · [View tests](../../../../packages/annotations/src/desktop/annot-view/AnnotView.test.ts)

When an event can come from a pop-out window, use Obsidian's cross-window `instanceOf` to check whether its target lies in the open field. Close an editor in capture before a click elsewhere reaches its target. Leave empty list space to the list's own close-and-clear action. [Annotation View events](../../../../packages/annotations/src/desktop/annot-view/AnnotView.tsx) · [Pop-out window policy](../../../../apps/obsidian/policies/popout-windows.md)

Open one card editor at a time. Select the card alone and save and close the previous editor before opening the next one. A text editor opens when the repository accepts the draft. Keep Edit quoted text in the card menu as a less frequent correction action and route its press through the same control as the field. [Editor actions](../../../../packages/annotations/src/desktop/annot-view/actions.tsx)

Render the comment editor or the saved comment in the same slot below the excerpt. The selected card can offer the field even when the host hides ordinary comments. Quoted Text editing stays in the Excerpt Block. Show an empty placeholder when a quoted field has been cleared so its edit action remains available. The edit control occupies the end of the first line and appears on pointer hover, keyboard focus or a coarse pointer. Its wrapper owns the reveal so the button's blocked state remains visible.

Submit an untouched draft on close so the repository can discard it. Read the caret coordinates once at mount when a pointer opened the field. Blur and the explicit save shortcut keep the editor open. Escape closes it, returns focus to the card, and suppresses another save from the closing blur. [Card text editor](../../../../packages/annotations/src/desktop/annot-view/Annotation.tsx)

## Shared editor sheet and field behavior

Draw the editor sheet with the same builders in the Annotation Card and Mark Popup. Use the field's wording for its name, placeholder and Save button. Share a box between the idle comment and open editor so the text stays in place. Keep the theme's Markdown styles on rendered comments and compact them through the card stylesheet. Use a quiet tint for hover and editing, and an accent hairline for focus. The Excerpt Block's draft panel leaves the excerpt rule visible. The Mark Popup keeps its own inset.

Keep the status live region mounted, including when it is empty. The footer adds spacing only for visible content and lets buttons wrap below a long hint. An edit uses the save gesture appropriate to its draft state. Creation can supply an explicit commit button and keep focus in the field until its click. Only a focus move out of the sheet while the editor accepts an automatic save calls the blur handler. Disposing the editor does not call it.

A click on resting text starts editing at its pointer location only if it did not follow a link or select text in that field. Read the selection through the field's own document to support pop-outs. A held panel opens the editor with the caret at the end because its text occupies a different box. Use a separate accessible label so Obsidian does not render a tooltip over the typed text.

CodeMirror stores Zotero's inline syntax verbatim. Render each formatted pair and reveal the tags when the selection touches it. Convert pasted HTML to the supported Zotero formats by reading a detached parsed document. Leave plain-text paste to CodeMirror. Send small formatting edits and mark external text replacements so they preserve the local caret and do not count as user edits or enter undo history. [Editor sheet](../../../../packages/annotations/src/obsidian/annot-view/editor-sheet.ts) · [Field editor](../../../../packages/annotations/src/obsidian/annot-view/field-editor.ts)

Keep the rendered comment's node when a card becomes selected alone so its text selection survives. Use a distinct key for the placeholder because it does not share the Markdown renderer's children. On an editable field, keyboard focus can start editing. A pointer click supplies the caret position, and a click without pointer coordinates uses the default. Use a hidden accessible name for a resting field, and keep a stable field instance while incoming text or status changes. On disposal, clear the owner's sheet ref only if it still refers to that sheet. [Comment field and sheet wrapper](../../../../packages/annotations/src/obsidian/annot-view/comment-parts.tsx)

A closing editor clears the editing target only while it still owns it. This lets a late unmount leave the replacement editor open. [Editing target](../../../../packages/annotations/src/obsidian/annot-view/model.ts)

Interpret the attribute-free `b`, `i`, `sub`, and `sup` pairs and line feeds from Zotero's stored syntax. The parser is intended to find the earliest opening tag with a closing partner, parse its contents recursively, and leave unmatched or crossing tags as literal text. Keep ordinary angle brackets in prose. Use the same complete pairs for copying plain text. [Zotero formatting and parsing](https://github.com/zotero/zotero/blob/9.0.3/reader/src/common/components/common/editor.js#L66)

A format toggle removes a format from a selection when every selected visible character carries it. Otherwise it adds the format to that range. At a caret the toggle unwraps the surrounding format or opens an empty pair to type into. Serialize the resulting runs in the editor's format order and preserve the direction of the selection. Paste converts strong and emphasis to bold and italic, keeps supported inline formats, and translates block edges to line breaks. Ignore non-content elements and drop a format pair if it holds only whitespace. [Zotero paste rules](https://github.com/zotero/zotero/blob/9.0.3/reader/src/common/components/common/editor.js#L112) · [Comment formatting](../../../../packages/annotations/src/core/annot-view/comment-format.ts)

Create-mode comment entry submits with the named create button or Ctrl/Command+Enter. The text travels with the create and has no independent draft or manual save action.

In the selected popup, the comment itself opens the editor, including when a held draft occupies the field. It has no separate row verb.

Resolve rendered Mark Popup comment links against the Annotation's Literature Note, using the vault root when it has none. Drag insertion uses the same Annotation actions as the card and ends with the Reader scope.

A blocked comment field remains readable and a press reports the reason, as on the Annotation Card.

Check the empty Mark Popup comment through its placeholder,
since the row has no separate comment verb. A press collapses
a previous selection before its click. Clicking over selected
page text alone does not edit the comment. An outside press
closes the editor and saves it. Restore the empty seeded comment
after the Reader settles.

[Paired comment field case](../../../../packages/e2e/src/paired-run.e2e.ts)

Observe both the Mark Popup and Annotation Card comment
through blur and read-back. Check the frames immediately
after save for a return to the old comment. The new text
can replace it once, while the editor becomes a clickable
field again. Check reopening on the first render after the
click. The press first collapses any page selection.

[Paired comment transition](../../../../packages/e2e/src/paired-run.e2e.ts)

A held Query refresh leaves a published card and its editing
capability available. Opening tags first saves and closes
the comment. Opening the comment first ends the tag session.
A card selected with others has no editable comment field.

Use trusted input when the check depends on focus moving.
Click outside the card's comment field to save and close,
or click the PDF to blur, save, and retain the card editor
and selection. Escape in the editor closes it so PDF
selection can apply. Opening Edit quoted text selects that
card alone and puts the caret in its Excerpt Block.

[Paired editor handoff cases](../../../../packages/e2e/src/paired-run.e2e.ts)
