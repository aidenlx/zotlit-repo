# The web Workbench edits one source document

> **Amended by [ADR 0100](0100-the-web-template-workbench-is-retired.md).** The web host is retired. The editing model below, one source document with targeted edits and one undo history, stays in force for the Template Workbench View; the passages on the web host, its connected Save and its transport are history.

The web Template Workbench presents one Profile document through body and
Annotation editors, Properties, Details, and Advanced. In the
[#930 design session](https://github.com/aidenlx/zotlit/issues/930), we chose
the complete source text as the authority, with parsed values as a derived
view. Every form or editor change applies a targeted source edit, preserving
unrelated bytes, including YAML comments, key order, quoting, and line
endings; Save writes that source. This preserves hand-written documents
across the different editing surfaces, at the cost of source mapping and
targeted YAML edits instead of whole-manifest serialization.

All surfaces share one document undo history, including text edits, form
changes, row operations, and structural actions. Switching Advanced on or
off preserves that history and adds no undo step. Save preserves history
and marks the saved source. Invalid drafts remain editable in memory;
existing document and Profile validation errors block the web's connected
Save, while errors found only during preview remain separate from Save.
(Amended 2026-09-07: that blocking rule is the web transport's; the Obsidian
Profile Editor autosaves the file and shows the same errors in Problems and on
the settings row, see [ADR 0045](0045-the-profile-editor-is-a-dedicated-view-beside-the-markdown-view.md).) Problems shows the
first validation error alongside a local indicator; selecting it opens
the affected Properties row, Details field, Annotation editor, or Advanced
source when its location is available.

Recovery follows KISS. The active editor keeps the user's text while
validation fails, and form refresh and Save wait for a valid document.
The user repairs the text in the current editor, uses Undo, or opens
Advanced. YAML that a form cannot safely edit remains available in
Advanced with its source preserved. Use the existing parser and one
cohesive editing core as the starting point.

Rule rows edit JSON source stored directly under `value` in the YAML
manifest. The property editor displays JSON with two-space indentation and
writes compact JSON to that source. Offset maps connect completion, hover,
selection, and replay to the formatted editor. Draft snapshots, including
formatting-only changes, belong to the same document undo history.
(Amended 2026-09-28: a hand-written `value` may use any YAML form the
manifest parser reads, such as a block mapping or plain text. The Workbench
reports a rule only when the manifest cannot read it. A rule in another YAML
form shows as formatted JSON of the value its own text reads as, and its first
edit stores that value as compact JSON, so comments inside that one rule do
not survive the edit. Other entries keep their bytes.)
(Amended 2026-10-01: a manifest scalar that a pane edits — the note name and a
Liquid property rule — shows the text YAML reads, without its quotes or
escapes. Every edit stores a YAML spelling that reads back as exactly the
typed text: the scalar keeps its quoting while that quoting holds the text,
and otherwise takes the first of plain, single-quoted, and double-quoted that
does. A note name written as a one-line block scalar is edited as its line,
which YAML holds as written. The controller chooses this rule for each slice,
so typed text cannot make the manifest invalid; see
[discussion #1197](https://github.com/aidenlx/zotlit/discussions/1197).)
The [JSON-e editor design](../research/json-e-editor-design.md) restores
the JSON authoring syntax from the
[#938 ruling](https://github.com/aidenlx/zotlit/issues/938#issuecomment-5468828547)
and retains the shared source as authority. JSON-e remains the evaluation language.
Fixtures and starter rules change with implementation; migration is outside
scope because this beta has not shipped.

The web and Obsidian hosts share document edit rules, history, source
mapping, and structural editor extensions. Each host supplies its layout,
popup presentation, file access, and transport. This keeps the editing
contract consistent when the web surface is ported to Obsidian;
[#931](https://github.com/aidenlx/zotlit/issues/931) owns the transport
contract. The three-column layout and default depth from [#938](https://github.com/aidenlx/zotlit/issues/938), the language
interactions from [#932](https://github.com/aidenlx/zotlit/issues/932), and the Annotation tab from
[ADR 0041](0041-annotation-format-has-its-own-workbench-tab.md) are the shell's
settled inputs. The detailed Properties, metadata, preview,
data exploration, and onboarding prototypes remain with their respective
child tickets under [#863](https://github.com/aidenlx/zotlit/issues/863).

## Eta tag boundaries in the shared editor

The Workbench uses a Lezer grammar for Eta tag boundaries. It keeps the
tag body as tokens for range detection and lets the Eta engine interpret
the body. Strings and block comments consume embedded closing delimiters
so an embedded delimiter cannot end the editor's tag range. An unfinished
tag still gives the completion engine a body range, so suggestions work
as the author types before entering the closing delimiter. The parser
and range functions run without editor state or DOM dependencies. This
lets editor input and other template tools use the same ranges.

The source grammar is
[`eta.grammar`](../../packages/workbench/src/language/eta.grammar).
The generated parser and term table are built from it with `generate:eta`.

## The web editor during a repair

Retain the last parsed manifest for the header and Name and folder form while source is incomplete. When the Properties list has no editable slice, open Advanced with the original source. Close a selected entry that no longer has a slice. Property rows combine parser and renderer diagnostics, and the Problems area captures parser failures before a render can start. Offer the Update Managed Region result only for the Note, and show annotation format errors at the format editor.

Fields use the Annotation root in the annotation editor, the Filename root for the one-line filename value, and the Note root elsewhere. In Advanced, resolve the root from the caret and the controller's existing ranges. A filename that has no one-line slice belongs to the Note root. Resolve completion and hover against the available partials from both the manifest and the connected bundle.

JSON-e Filter Expressions read the root as a property. Liquid retains its template variable for the same root. The web page can display the Citation root through the shared field list for the sample Item and edits the Profile rather than its Citation Template.

## Document controller and slice ownership

Use one master CodeMirror state and undo history across the Profile
panes. A Citation Template or Shared Partial has one editor for its
optional manifest and source. The Shared Partial's host supplies the
caller context for completion and Preview. The last valid engine and
language stay available during repair. Changing language edits the
manifest and leaves the source for the author to rewrite.

Track positions in the document state, where each line break counts as
one character. Preserve the document's CRLF or LF convention on save,
render, and download. Split inserted text into lines so LF from an editor
does not become a literal character in a CRLF line. Reconcile disk text
as an undoable edit without writing the same change back. Replace the
changed span only and keep matching text in place.

A focused slice with a registered editor owns its current range. The
master lets that slice's edits and undo or redo through. For edits
originating elsewhere, keep the focused range out of the master change,
rebase the suppressed part over the applied change, and replay it
through the owning editor. An insertion exactly at a range boundary
belongs to the master. Split a change that crosses the boundary and
attach the inserted text to the side on which it starts. Apply a
structural Properties action as one master edit when it rewrites the
focused row itself, then let a surviving row restore focus. A removed
row temporarily reads an empty range until its editor unmounts.

Keep author formatting when patching YAML, including comments, key
order, quoting, and line endings. Place a new key at the end without
moving existing keys. Plain documents accept an empty or comment-only
manifest with the Liquid default. The Match field can read authored YAML
as well as the JSON form it writes. Present manifest scalars as decoded
text and JSON-e rules as formatted JSON where a pane can patch them;
leave unsupported forms to Advanced.

During a failed parse, keep the last manifest and Properties rows and
remap the ranges so the author can repair the same slice. Disable
Properties structure changes while the list is held. Remove ranges for
parsed shapes that the forms cannot patch. A plain document with a broken
manifest gives its single editor the whole source. Route a validation
problem to the pane that can repair it, preferring the editable manifest
field or Properties row the parser names. Keep structural errors in
Advanced. Read annotation calls and the Managed Block from source so
their boxes survive an invalid draft. Keep the Annotation Section header
and its preceding structural newline outside the note slice. The first
edit to an empty note adds a separator when the header shares its offset.

Refresh text-derived atoms on a text edit or controller replacement.
Read-only state and revision also observe updates without a text edit so
undo controls and selection readers can refresh.
[Document controller](../../packages/workbench/src/document/controller.ts) · [Document atoms](../../packages/workbench/src/document/atoms.ts)

### YAML edits and slice text

Use narrow patches for the scalar nodes a form owns. Keep the quoting
style while it can represent the new text. Refuse a mapping or sequence
where a scalar edit would leave child lines behind. For the one-line
content of a block scalar, the editor range leaves the header and its
indentation outside the slice. When YAML node offsets include the next
line, stop the expression slice at the last content character. A block
entry starts at its sequence marker, including when its first key
starts on the following line.

The first Properties entry can create the list or replace its empty
value. The last removal writes `[]` because a bare key is null and fails
the schema. A reorder moves entry text and leaves the gaps between rows
in place. A new field uses the columns of the surrounding keys. A
keyless Spread Entry needs a mapping-producing rule. A language change
uses the new rule's starting text and remains one undo step away from
the previous expression.

Preview output refers to entries by their one-based positions. Translate
those positions to the current list using exact entry text first,
matching duplicate text in list order. When unmatched counts agree,
pair their positions in order. Otherwise match only an unmatched row
still at the same position. Removed rows have no mapped output.

In a JSON-e editor, format valid JSON without changing token spelling and
store compact JSON in YAML. Keep separators in unfinished input so adjacent
tokens cannot merge. The JSON scanner's token constants mirror ambient
const enums that verbatim module syntax cannot import. Display a YAML rule
as its decoded value and store JSON on the first edit. If a suppressed edit
reaches such a rule, apply it to the YAML before decoding the new text.
Restore formatting-only changes and the precise child selection through
the master undo history.

Map shown and stored offsets through YAML quoting and escapes. An offset
inside a surrogate pair maps to the code point's start. Include the
prefix when reading a scalar for its indentation. Treat the sequence
marker as indentation, and catch an unresolved alias reported as an
exception. Read the slice codec again when applying edits because
Advanced can switch the stored scalar's style while the pane is open.
Provide a space after the colon when inserting into an empty YAML value.

Route slice undo to the master before host bindings. Child typing
forwards its user event so keystrokes group into one undo step. Refresh a
child with the full current slice so undo that touches a boundary still
maps correctly, then stop the echo when its text agrees. Restore its
caret for undo or redo called from elsewhere.
[YAML patches](../../packages/workbench/src/document/manifest-patch.ts) · [Slice editor](../../packages/workbench/src/document/slice.ts)

The Annotation render test Profile replaces the Query Block with a
static listing and puts it within a Managed Block so the update test
exercises re-rendering the section for each Annotation.
[Render test Profile](../../packages/workbench/src/render/test-profiles.ts)

In a standalone Preview, Update uses a synthesized note and assumes a
free filename. The vault resolves collisions when it saves. Show the
note's relative path without the extension, preserving subfolders.
Evaluate every Properties entry against the same snapshot independently,
then fold contributions in list order. The first contribution sets the
key's position. Preserve row positions for merge-conflict diagnostics.
Show the final generated YAML and omit keys the fold did not produce.

Mark successful Annotation output only where that rendered text
appears in the body. Search forward in reading order so identical
outputs get separate ranges. Omit empty output and output from an
Annotation the body did not render.
[Profile renderer](../../packages/workbench/src/render/index.ts)

### Name and Properties forms

Keep the last valid manifest visible during repair. Name and folder
owns path and inherited bindings. Profile owns identity, language,
and compatibility. The Default Profile's vault bindings are read-only
here because the host owns their settings. A connected host supplies
its effective values and installed CSL styles; standalone uses the
built-in defaults and a style ID field. Keep a stored style visible
even when it is absent from the installed list. For a folder, an
empty path names the vault root. For a style, empty means no style.

Commit text on blur as one undo step and keep the control mounted so
the next clicked control receives the click. Read the actual input on
blur because the latest input state may not have rendered. Remove an
optional string key when cleared. Restore inherited values by removing
the override key. Reveal a manifest finding at its named control and
open a collapsed group first. A language change writes one key and
leaves authored content available to rewrite.

Show a Properties entry's own output and order spread keys by their
position in the final fold. Keys the fold dropped follow in the
entry's own order. A folded row shows its finding instead of a value.
An open row shows the finding beside the source. Keep the editor
mounted for an opened entry until another entry replaces it. The
Properties and Preview grids use the same lightweight renderer
without loading Markdown to show property values.

Reorder rows by drag or Alt+Arrow on the handle. Resolve drops at
row edges or the end of a group. Adjust indices after taking out the
source and keep keyboard focus with the moved row. Read drag state
through refs because consecutive drag events can arrive before a render.
Use the pointer position when Chromium omits the related target. Draw
the row as the drag image, using a temporary compositing layer so
rounded corners remain transparent. Restore its prior style after
capture and fade the source row afterward.
[Name and folder](../../packages/workbench/src/ui/name-folder.tsx) · [Properties](../../packages/workbench/src/ui/properties-tab.tsx) · [Row reordering](../../packages/workbench/src/ui/reorder.ts)
