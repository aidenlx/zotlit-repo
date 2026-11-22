# The Profile Editor keeps Liquid assistance and basic Eta editing

> Amended 2026-09-12: Eta semantic completion and Eta Template Hover return to this
> support tier. Both read the small Eta grammar and the template contract, not a
> JavaScript tree, so the editor keeps the bundle saving this decision was made for.
> The JavaScript parser, JavaScript syntax coloring, and full JavaScript context
> analysis stay outside the tier, and Eta tag bodies keep their plain code styling.
> Because a plain tag body carries no token element, Template Hover resolves from the
> document offset under the pointer and confirms the pointer against the resolved
> token's own boxes. The bundle limit and every other decision below stay in effect.

The Profile Editor gives frontmatter one text color and adds small Markdown hints while
keeping Liquid highlighting and assistance primary. Markdown hints color
heading, list, and quote markers in Note, Annotation, and the corresponding
Advanced source; body text keeps its normal size and weight. The implementation
uses existing language libraries and keeps the production bundle small.

Liquid keeps its token colors inside Markdown code spans and fenced code
blocks, where the template engine still evaluates it. Liquid raw bodies and
comments retain their literal treatment. Within YAML fields that contain
Liquid, template tokens keep their colors. Frontmatter lines use the public
`zt-template-frontmatter` hook and default to `--text-muted`. Heading and quote
markers default to `--text-faint`; list markers use `--list-marker-color`.
These colors follow Obsidian's Source mode. Every pane keeps its existing
monospace font, code size, spacing, and background. The editor uses the existing
document boundaries for frontmatter styling. The runtime `yaml` AST continues
to support source-preserving Profile edits; the CodeMirror YAML language and
Lezer YAML parser are removed to reduce the editor bundle.

Eta retains source editing, basic delimiter colors, Explorer insertion, and
rendering under the existing JavaScript Templates gate. The Profile Editor
reuses the shared automatic-pairing handler: typing `<%` creates `<% | %>`
with the caret at `|`; prefix and trim-marker input, generated-closer skipping,
empty-pair deletion, and pair history remain supported. Selection wrapping
retains the useful capability supplied on `main`.

The existing small Eta Lezer grammar supplies delimiter colors and pairing
context. Its tag boundaries follow Eta's delimiter rules for quoted strings
and block comments, including a tag preceded by another `<`. Incomplete tags,
strings, and comments retain usable editing context. Eta tag bodies and `js`
Properties use plain code styling. The JavaScript parser, Eta semantic
completion, Eta Template Hover, and full JavaScript context analysis are
outside this editor support tier. This trades advanced Eta assistance for
better support of the default Liquid workflow and a smaller bundle. The Eta
render engine remains independent of the editor language support.

The combined change must keep raw production `main.js` at or below the
2,206,489-byte baseline measured after commit `c674dbd07`, with the same build
settings. A comparison of complete production builds determines acceptance;
individual parser measurements are estimates. This extends the Profile Editor
contract in [ADR 0045](0045-the-profile-editor-is-a-dedicated-view-beside-the-markdown-view.md).

The implementation contract is [spec #1077](https://github.com/aidenlx/zotlit/issues/1077).

The docs TextMate grammar highlights Eta delimiters, escaped and raw output operators, and whitespace trim markers. It follows the parser's tag shape and keeps JavaScript unembedded so an unfinished block in one tag cannot swallow the template close. [Eta v4 parser](https://github.com/eta-dev/eta/blob/v4.0.0/src/parse.ts)

## Shared editor adapters

Read the current contract, registered partials, and Sample Item when
offering completion. The caret can move between render scopes in one
editor. Scope Liquid locals to their own render and retain a known
name when its member type is unknown. Present Sample helpers as their
output and represent cycles as references. Array samples support their
first and last elements.

Treat a completion edit as a separate undo step. A New partial action
waits for the host's answer and discards the edit if resolution fails
or the document text has changed. CodeMirror handles a late dispatch to
a closed view. Keep the row description separate from syntax examples:
a field description is a cell, while tag syntax and examples go in its
documentation. Rank shared suggestions in the core so the hosts show
the same order. Put the action row at the end regardless of the query.

Publish token colors through the Workbench theme hooks. Give token
marks precedence without changing when their plugin reads other
plugins' state. Preserve outer JSON styling around embedded JSON-e and
map decoded tokens back through JSON escapes. Use the recovered tree
for incomplete expressions. Operator metadata supplies authoring shape
and leaves value validation to the renderer. Tokenize each embedded
Profile value independently from frontmatter.

Find Liquid tag bounds even when a draft is incomplete. Quotes hide a
closing delimiter except in inline comments and liquid blocks. Skip
raw and comment bodies while finding later tags. Scan a ZotLit block
closer when the upstream parser rejects it. Use separate literal end
patterns for raw and comment, since neither needs captures. A generated
closer and its space move with the document and share the undo entry
that inserted them. Project that provenance into a slice when it mounts
or refreshes.

Expression Completion uses Query Dataset field types and the planner's
registries. Fetch the host vocabulary on each completion so a newly
added Formula can appear. Offer quoted lookups for names that need
brackets. Leave literal text alone. List methods use the planner's
bound names in the element expression, with the inner call taking
priority. After inserting a binding method, reopen completion at its
element expression. Apply edits at the range CodeMirror mapped to the
current document. Color call names from their position in the parse
tree, and do not pair brackets inside a string or regular expression.
[Template completion](../../packages/workbench/src/language/completion.ts) · [Filter Expression completion](../../packages/workbench/src/language/filter-expression-completion.ts) · [Template pairing](../../packages/workbench/src/language/pairing-state.ts)

### Expression Completion vocabulary

Build the editor vocabulary from the dataset, its Query Context, the
host's Formulas, and any permitted vault properties and custom fields.
A note can supply an Item for `this`; a standalone Query File has no
such context. A Formula does not receive the filter's vault properties.
Custom fields are quoted keys under `custom` or `item.custom` according
to the dataset. Other bracket accesses take ordinary expressions.

Use the planner's receiver type for member completion and the Signature
Hint. Prefer the receiver's record fields, then include properties of
the matching type and methods of that type or of any value. An unknown
type keeps the full candidate list. Combine return types when several
definitions share a name. Cache a receiver answer for the same source
and span. Read namespace access from the parsed tree so spaces around
the dot do not change its meaning.

Match field labels as well as paths, and omit a label that repeats its
path. Search Terms only affect discovery. An exact term beats a visible
prefix match and follows an exact visible match. A term prefix follows
a visible prefix. Keep source order for ties. Expression names and paths
use property colors, callees use function colors, and literal values
use the existing code colors.
[Expression vocabulary](../../packages/workbench/src/language/expression-vocabulary.ts) · [Member suggestions](../../packages/workbench/src/language/expression-members.ts) · [Ranking](../../packages/workbench/src/language/expression-options.ts)

### Popup keys, signatures, and template suggestions

For a focused popup, Tab and Enter accept its selected option and
Escape closes it. Keep Shift-Tab and IME input available to the host.
Use a host key scope while the popup is open where the host provides
one, and give keys back on blur, close, or editor disposal. The editor
can reacquire its keys after focus moves to a new window. The completion
list has priority over a Signature Hint. Once both close, Escape returns
to the host.

Read signatures from the evaluation registry. Identify the innermost
call that contains the caret. Use the receiver type when the planner
can supply it, preferring that type's method to a method for any value.
With no receiver type, show all matching definitions. Anchor the hint
above the opening bracket to leave room for a completion list below the
caret. Reuse the tooltip factory as the caret crosses its arguments.
Use CodeMirror's reported focus and preserve hidden tooltip dimensions
so its first visible placement uses the correct size.

A Template Completion pane offers registered partial names, including
ones the document has never called. Offer New partial last whenever the
host can write a file, and wait for its host-scoped result before editing.
In an otherwise empty call, pass `zt` by name for Liquid `render` because
it opens an isolated scope. Liquid `include` shares the caller's scope.
An Eta `include` receives `zt` as its second argument. Retain authored
arguments and the opening quote style. Offer array-to-loop replacement
only when the output contains the array field path alone. Leave pipes in
quoted strings as text. Switch the root to Annotation after the final
Annotation Section header. Hover reads the pointer location without
moving the caret.
[Popup keys](../../packages/workbench/src/language/field-popup.ts) · [Signature Hint](../../packages/workbench/src/language/signature-hint-tooltip.ts) · [Suggestions](../../packages/workbench/src/language/suggestions.ts)

Read custom fields through the editor model for each source revision.
A newer revision or editor disposal interrupts the old read. Leave the
custom key list empty while that read runs or if it fails.
[Custom field completion read](../../packages/workbench/src/ui/custom-fields.ts)

For Match expressions and Formulas, underline the field's own Syntax
Fault first. Show a run's Fault only while the field still contains
the text that run planned. Put wording in the host status line and
suppress the editor hover tooltip. The Query View and Formula
end-to-end cases cover these underlines in the running app.

Keep one editor view and read current props through a ref. Reconfigure
completion only when the vocabulary becomes available or unavailable.
Apply an external value during layout, before another key can arrive,
so an owner echo cannot overwrite newer typing. Distinguish the
external transaction from user input. The editor inherits the host's
input font and line height, centers its first line, and grows with
wrapping. Name the editable content by a hidden label to avoid a host
tooltip over the field.
[Filter Expression field](../../packages/workbench/src/ui/match.expression.tsx)

### Native completion, window migration, and popup keys

Use Obsidian's native suggestion classes for Template and Expression
Completion. Draw the type or signature on its own line so unions and calls
keep their reading order. Use the native note style for the description and
render its code spans as code. Apply the host's monospace typography to code
panes.

Attach Obsidian's window-migration listener to CodeMirror's scroller.
Obsidian uses a CSS animation to signal the move. CodeMirror rewrites its
outer class attribute and can remove the animation class. The scroller's
class stays in place. A closed popover can delay the signal until the editor
is visible. On focus, update the editor root before CodeMirror measures
the caret in the new window.

Place expression tooltips in the containing popover surface or the current
window's document body. The popover surface keeps clicks inside the popover
and lets tooltips extend past its scrolling content. Place after attachment
and after a window move. Defer the configuration to a microtask because
CodeMirror plugins cannot dispatch during construction or updates. Placing
the tooltip during the focus event can interrupt CodeMirror's caret handling.

A field popup takes a native Scope while it is visible and the field has
focus. Obsidian handles keys before the editor in each window. Parent the
Scope to the app Scope so unrelated hotkeys still work. Let composition and
keys the popup cannot handle continue to the field. Shift-Tab releases the
Scope before moving focus so the dialog can keep focus in its own bounds.
Release the Scope on window migration and reacquire it on focus in the new
window. An early release tells the field to request the Scope again if its
popup still needs it.

[Editor extension](../../packages/template-workbench/src/obsidian/editor/editor-extension.ts) ·
[Popup Scope](../../packages/template-workbench/src/obsidian/editor/field-popup.ts) ·
[Migration listener](../../packages/template-workbench/src/core/editor/editor-migration.ts)

In the Annotation filter dialog, Escape closes Completion before
the Signature Hint and leaves the dialog open. Tab or Enter accepts
a completion and leaves focus in the field, so the next key
continues the expression. Verify the handoff with a completion that
opens its own Signature Hint. Restore the test condition and close
the dialog before leaving the case.

[Filter dialog key test](../../packages/e2e/src/annotations.e2e.ts)

### Hosted expression field proof

Focus the editor as Tab does, without a click to move the caret.
Check the caret in state and on screen. Disregard the off-screen
tooltip position before CodeMirror measures it and allow the
pixel of movement CodeMirror can leave undone. An open Signature
Hint must stay inside the window, on top of the surrounding
surface, and track the active parameter. Moving outside the
call closes it.

Completion uses Obsidian's suggestion skin in the surface's root.
A call completion puts the caret between parentheses. Tab and
Enter accept while keeping focus. When Completion and Signature
Hint are both visible, they occupy separate sides of the caret.
Escape closes Completion, then Signature Hint, then the page.
Clicking a suggestion leaves the containing Filter open. Send
keys separately because the field can batch simultaneous input.

Use native code colors in light and dark themes. A single line
uses the native input height and aligns the caret; wrapped text
grows at the field's line height. A crowded or deeply nested
condition still gives its property select the full label and
keeps a chip value on one line.

[Expression field cases](../../packages/e2e/src/query-view.e2e.ts)

The Workbench language layer shares contract traversal between Completion and local-variable inference. Template and Expression Completion use one native suggestion skin. The Signature Hint tooltip gets its stable class from the plugin's theme hooks. Closing the hint suppresses it until the text or caret moves. The host runner returns a managed Fiber whose owner interrupts outstanding work on disposal. A Workbench host error retains the original render or host failure for diagnosis.

### Native popovers in editor fields

Place an active Completion or Signature Hint key scope above its enclosing panel or dialog in the Obsidian keymap. Obsidian receives keys in the main window and popouts before the editor receives them. Parent the scope to the app so untouched hotkeys still work. Accept the selected option with Tab or Enter and close the popup with Escape before the surrounding surface can consume the key.

Use the resolved token range as the hover card's identity. Move native target listeners before the previous target's mouseout handler can cancel the original enter timer. Retarget immediately and defer replacement of the visible content until the pointer dwells for the hover delay. Replace content immediately while the card is still waiting to open. A plain Eta tag uses its line for events and the resolved range for the hit test. Anchor to the token's first editor box, preserve Obsidian's side and viewport calculations, and recalculate after content settles. Unload the content when a visit ends before the card opens. Hover tests supply synthetic boxes because happy-dom performs no layout, and use the new pointer coordinates for the mouseout and mouseover handoff.

Read the localized Liquid tag descriptions at use time so hover and Completion follow the active Language Pack.
