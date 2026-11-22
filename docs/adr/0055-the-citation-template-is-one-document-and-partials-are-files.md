# The Citation Template is one document with a gesture variant, and Shared Partials are files

After the Literature Note Template moved into one Profile document per Profile (ADR 0025, ADR 0031, ADR 0035), two vault-global things stayed in the 2.1.x per-slot shape: the `cite` / `cite2` pair and the bare partial files `zotlit-<name>.liquid.md`. The Template Workbench had no editor, preview, or data root for either. We decided that both become Template Documents the same view opens, beside the Profile document.

**One Citation Template, one gesture enum.** `zotlit-citation.md` replaces `cite` and `cite2`. The citation suggester hands the template a Citation Variant — `main` on Enter, `alt` on Shift+Enter or a trailing `/` — and the template decides what each variant renders. The variant names the gesture only. The alternative, keeping two files or handing the template a Pandoc form such as `prefer-author-in-text`, was rejected because the two gestures do not mean parenthetical and author-in-text; that is one mapping a user may keep, change, or drop inside one source. An annotation's `zt.citation` renders the same template with the `main` variant and a page locator. Citation data enters the Template Contract as the `citation` root, so the explorer, completion, the CLI, and the generated reference share one description of it.

**Shared Partials are files; the manifest copy is a transport.** A partial is `zotlit-partial.<name>.md`, vault-global in one flat namespace, per ADR 0025's ruling. The Profile manifest's `partials` list exists only so a Profile shares as one pasteable file: import unpacks each entry to a file, and a document opened for editing that still carries one reports a problem with an Unpack action. A partial has no root data of its own; the Workbench previews it under a context the user chooses — Note, Annotation, or Citation — and remembers per file. Inference from callers was rejected: it fails on an unused partial and on one called from two roots.

**Plain documents, prefix classification.** A citation or partial document is an optional YAML manifest carrying `language`, then one source; no frontmatter means Liquid. The template folder classifies by prefix — `zotlit-profile.`, `zotlit-citation`, `zotlit-partial.` — and reports any other `zotlit-` file once in settings. A one-shot converter, the same prompted and byte-verified pass that folds the note slots, folds `cite` plus `cite2` into the if/else form and renames each bare partial. Only the 2.1.x shipped shapes convert.

**Dependencies stay a recommendation.** The textual dependency scan preselects the Share checklist and does nothing else: no reverse index, no "used by" cue, no scan-based problems. A missing partial is the engine's own render failure, surfaced as a diagnostic that names the partial with Create and Pick actions in the Workbench, and as a refused Literature Note render with an Open template workbench action in the vault. A note with a silent hole was rejected in favour of a refused write.

## Consequences

- ADR 0025's line "`cite` / `cite2` stay vault-global template files outside the Profile" is superseded by this ADR; its partial-namespace ruling stands.
- The Template Contract version bumps for the `citation` root; the hand-written citation-template reference page retires into the generated one.
- The web Workbench is unchanged: the bridge stays Profile-shaped and bundles `zotlit-citation.md` under the name the annotation preview expects. Citation and partial editing are Obsidian-only until the bridge gains a document kind.
- The Obsidian view formerly named Profile Editor opens all three kinds; the tab set and the preview root follow the kind.

## Mixed-language rendering

The facade dispatches by registered name and gives Liquid precedence when both languages define it. Eta's named include resolves through its render method, which the facade intercepts. Calls that pass a compiled function use Eta's original path. The facade exposes synchronous rendering. Liquid's in-memory filesystem supplies a bridge tag whose read owns name resolution, so a missing partial raises a typed error with the name. The file adapter supplies both synchronous and asynchronous methods because the LiquidJS interface requires both. Use the registered name as the source filename in Liquid errors.

The bridge renders Liquid partials in the child context already created by the native tag, retaining its aliases, named arguments, and scope. Eta targets use the named render path with the child context's data root. Apply the same output transform to named renders and includes. Static Liquid variable analysis reads only one source at a time because includes get synthetic bridge text. Analyze each referenced source under its own name. Read location rows and columns as one-based positions.

Legacy Citation Template conversion compares each variant's inline output with the replaced legacy render before the caller writes it. Render the converted source with names scheduled for removal hidden from direct calls and includes. A conversion render failure becomes a refusal the prompt can report while the legacy files stay available.

A plain Template Document has one source below its optional manifest and defaults to Liquid. Serialize a manifest even for the default language so template source beginning with its own fence survives a round trip.

The fold uses the built-in branch for a legacy slot the vault did not override. Its indentation keeps each branch readable and disappears in the inline form, which collapses whitespace runs containing a line break and preserves interior runs of plain spaces. Tests compare the default Liquid and Eta output bytes. Keep the gesture names local to the fold because the database package depends on the template engine.

Liquid tracks the entry data root separately from assignments. Distinguish a caller-data error only when the executed first formatter reads the entry root directly through `zt.citations`. A reassignment, other expression, or preceding filter can change the input. Validate the untyped template value at the adapter and validate directly supplied items at the serializer boundary. Each source format keeps its own errors.

Scan direct children of the template folder. Recognize the Citation Template by its exact filename and register its source as `citation` in every host. Use the bundled source until there is a vault document. Its default variants preserve the legacy main and alternate citation behavior.

A Shared Partial cannot take a registered template slot name because the facade has one namespace. Keep the Citation Template name and the legacy note slots reserved, including the Annotation Section's slot. Normalize a name entered in the UI with hyphens and lowercase. Check duplicate names without case so manually created files cannot collide on a case-insensitive filesystem. Leave a bare legacy file named `zotlit-citation.liquid.md` unrecognized because it cannot become a partial of that name.

Store the conversion result with a null document when there were no Literature Note slots to fold. Keep legacy files that failed to move to trash in the pending cleanup list so Welcome can retry. Read older results with an empty list.

Citation suggestion handlers render synchronously. While the Template service is loading, return null so the caller can show the loading notice. Pass the selected Item as well as its Citation Key so a Citation Template can render author, title, or date data.

Route the command, Citation settings row, and Template Workbench through one open action. Materialize the built-in source on the first open so the user edits the text they already see. Reset moves the customized document to trash. A Workbench-originated open uses a new tab in its window. Report an open failure with a notice and let interruption pass through without one.

Keep bare legacy registration available until the converter replaces the files. A Shared Partial document wins over its legacy file so the later trash event cannot unregister the new document. Fold legacy citation slots in gesture order. Liquid wins a mixed-language pair and the unconverted Eta source stays in the vault. Verify renders against the registry that will remain, including removing the Literature Note slot names that the same conversion replaces. Reconcile the Citation Template on every full rebuild so a vault without its file still registers the bundled source.

Bundle the parsed source and language of each Shared Partial, including an inert Eta document, without the document manifest. Include the Citation Template for web exports. A failed manifest parse displays the default language. When unpacking, drop a transport entry only when an exact-name file supplies its source or the user kept that exact-name file. Report invalid names and case-only conflicts separately, and leave those entries in the bundle. Validate a pasted name before using it as a path. Report a reserved-name document in settings without registering it.

## Template folder reconciliation

Use the stored folder's spelling because the scanner compares exact paths, even on a case-folding filesystem. Adopt the vault's spelling at layout readiness when startup metadata was unavailable. Bucket folder and vault changes by document kind and feed events and flush requests into one ordered intake. A newer folder generation supersedes reads started by the previous rebuild. Yield before publishing the rebuilt snapshot so other settings consumers can observe the same settings first. Wait for reconciliation after a template-document write with a bound on the wait.

Collapse line-break whitespace in rendered citation text so it inserts as one token on the current line. Open an existing Citation Template without replacing it. A Shared Partial file that the parser rejects still owns its name, but its unreadable source cannot be bundled. An inert file with readable source can travel because the recipient's JavaScript Templates setting controls its execution.

## Citations in Imported Notes

Use the cited Group Library when a URI names one, even if the note's Library has the same key. Resolve other cited keys within the note's Library. Prefer a live Citation Key, then look for an embedded key against each cited URI, then show a parseable Item key with a question mark. Supply the full embedded CSL item data when the live Item is unavailable, including when the database is degraded. Keep raw citation HTML when every reference lacks a usable key.

Render all references in a Zotero citation mark together so the Citation Template controls grouping. Trim its structural newlines to keep the mark inline. Turndown emits this replacement without escaping its citation syntax. Use short CSL locator terms with the page abbreviation as the default for an absent or unknown label. [Child Note parser](../../packages/notes/src/desktop/note-import/note-parser.ts) · [CSL English locale](https://github.com/citation-style-language/locales/blob/master/locales-en-US.xml)

Imported Annotation callouts use the same Citation Template and page locator as drag insert. Parser tests cover live and embedded citations, cross-Library collisions, and the missing-key marker. The default-template case combines the production data adapter and template directly. Other cases can supply a citation renderer with Citation Key, locator, label, and author suppression. [Child Note parser tests](../../packages/notes/src/desktop/note-import/note-parser.test.ts)

Refresh the folder inventory explicitly so a file that appeared without a create event can still register. Test a rename followed by an edit in the same tick, and the conversion's create and trash events in separate debounce windows. Test that a partial created after the import plan survives the write, and report any invalid transport name that cannot be written.

A selected Item supplies a single reference for Citation Template preview with no locator or affixes, as for a plain Enter insertion. Built-in example sets require no database read. Copy Citation and `zt.citation` share the same parent Item and page locator inputs and use the main variant. Attribute an unnamed error from the Annotation's citation getter to the Citation Template and preserve an error that already names its Template. [Template Data](../../packages/notes/src/desktop/template/data.ts)

Coalesce concurrent folder rebuilds. Tests that need two observable reconciliations request the second after the first completes. Unload stops a waiting caller and lets an admitted partial write finish. Keep the engine runner available until an active unpack's Scope closes. A closed migration has no work left to settle. [Template lifecycle tests](../../packages/notes/src/desktop/template/lifecycle.test.ts)

Register the Citation Suggester in the Notes feature that supplies the Citation Template. Citation consumers read Profile styles through a port filled by that feature. [Desktop Notes feature](../../packages/notes/src/desktop/feature.ts) · [Portable Notes feature](../../packages/notes/src/obsidian/feature.ts)

The vault editor reports a manifest's transported partials until Unpack
partials puts them in vault files. The web editor uses the same
manifest list as its bundle. After the corresponding vault files exist,
remove their manifest entries in one undo step and leave the rest of
the authored bytes in place.
[Document controller](../../packages/workbench/src/document/controller.ts)

## Partial Placeholder boundaries

Use source positions so the placeholders survive a broken draft. The
Liquid scanner recognizes a closed `render` or `include` with a quoted
name. The Eta parser recognizes a closed tag containing one direct
`include` call with a string name. Leave dynamic names and other call
shapes as source. Skip Liquid raw and comment bodies, Markdown fences,
and inline code spans. An inline code span closes only on a backtick
run of the opening length. The Eta scan skips parentheses in quoted
strings and block comments when finding the call end.

Keep the argument text for the placeholder summary and track the name's
exact range so replacement cannot match a short name inside the
keyword. The host and placeholder scan share the same reserved names for
legacy slots and the Citation Template. Exclude those names from
Edit partial, while keeping them as call sites for render diagnostics.
[Partial call regions](../../packages/workbench/src/document/regions.ts)

## Preview data choices

For a Shared Partial, retain the selected caller context per file. A
partial can have no callers or callers from several roots, so its call
graph cannot supply one context. Read the caller context and binding
Profile together. A missing Profile selection uses Default.

Build Citation example references on demand because the browser can
install Temporal after the module loads, and restoring Sample Item
dates needs it. Match a live Citation's allowed fields by removing
note-tier fields from the restored filename root. Keep the bundled
highlight's page label as the Annotation citation locator. A missing
label is a fixture defect. Supply the literal leading or trailing
space in affix examples because the formatter preserves the input
and Pandoc needs a separator.
[Partial Preview](../../packages/workbench/src/render/partial-preview.ts) · [Citation examples](../../packages/workbench/src/render/citation-examples.ts)

Build the Annotation's citation during render from the parent Item and
page label using the main Citation Variant. A snapshot supplies the
Item data but no pre-rendered citation. Leave the value absent without
a Citation Template or a parent citation key.
[Annotation citation renderer](../../packages/workbench/src/render/index.ts)

Show one open Partial Placeholder preview per pane. Keep the open
call in master offsets, and update it through edits from other panes.
Reuse portal hosts while CodeMirror moves the preview below its call.
Render through the host for the pane's caller data, and stop observing
the partial when no preview is open. A missing-partial finding comes
from the renderer and leaves a short source marker that opens
Problems. Without a host, calls remain editable source.

Use the vault's full registry for partial suggestions when it is
available. The standalone page instead uses the draft's dependency
scan and has no creation action.
[Partial Placeholder](../../packages/workbench/src/ui/partial-boxes.tsx) · [Partial suggestions](../../packages/workbench/src/ui/partial-suggestions.ts)

### Extract a Shared Partial from the editor

Write and open a new Shared Partial in the caller's language. Pass the
caller's root in the resulting call. Liquid's `render` opens an isolated
scope, so pass `zt` by name. Offer extraction only for a selection in a
region that can render a partial. Include the clipboard actions because the
custom menu takes the place of Electron's context menu.

Replace the selection in one history entry. Undo restores the text and keeps
the file. If the document changes while the name prompt is open, keep the
editor text because the old offsets may select different text. The created
Shared Partial remains available.

[Extraction](../../packages/template-workbench/src/obsidian/editor/extract-partial.ts)

Share one creation flow across completion, menus, settings, and placeholders.
Use the shared naming rule and the `zotlit-partial.<name>.md` filename.
Write a language manifest when the document needs one. Liquid is the
default. Open the document beside its caller when possible, or in a
Workbench window when no caller leaf is available. A caller may leave the
workspace layout alone. A cancelled create stays silent and a write failure
keeps its log and notice. A document absent from the partial registry does
not get a partial editor because no render can call it.

[Create flow](../../packages/template-workbench/src/obsidian/view/new-partial.ts) ·
[Document kind tests](../../packages/template-workbench/src/obsidian/view/document-kind.test.ts)

Use the vault registry for Shared Partial completion, including names the current draft has never called and the action to create a Partial. Without the registry, offer the bundled names found by scanning the draft.

Render a draft Shared Partial using the caller selected in its own editor. A Partial Placeholder within a Profile uses the registered Partial source and the open Profile draft's bindings and slice root. Load connected roots through the same path as the surrounding Preview and restore sample data from its snapshot. This keeps folder, Citation Style, and import settings consistent with an actual caller.

Use the same Shared Partial creation command in the Workbench and Settings. Validate the requested name and write the corresponding Partial document. The caller owns where to open it. Close the prompt if its leaf runner is interrupted. A Workbench failure logs the failure and shows a notice. Dismissal returns no selection.

Persist a Shared Partial's chosen caller and Profile against that Partial's file on the device. Restore them together, with Profile first, before the root subscription saves the pair. A different Partial begins with its own saved or default caller. The selected caller supplies the root and available example choice. A plain document keeps one source and does not inherit a Profile's tab or Basic and Source setting.

Use the same Partial creation flow for extracting a selection. Preserve the document's language and emit a manifest so a leading delimiter in the selection remains body content. A language change edits the manifest while the reader rewrites the template. In the Partials menu, open registered documents, offer creation for missing calls, and keep Unpack with the other file actions. During unpack, keep an existing file with the same spelling and drop its bundled entry. If only a different-case file exists or the write refuses, retain the bundled entry and report the outcome. Show missing Partial highlights from the render's failure evidence.

Treat extraction as its own undo step. The preceding keystroke remains a separate step. If the draft changes while the naming prompt is open, preserve the edit and decline to replace the stale selection. The editor handles Cut itself when its menu replaces Electron's native menu.

Save the Shared Partial's caller and Profile with its workspace document so a
restored editor can recover a choice that the file alone cannot supply. Key
each caller's Preview by its name and context. Refresh it after a Partial save
or a change to its Item data, and report Item read failures there.

[Desktop model](../../packages/template-workbench/src/desktop/view/model.ts)

Classify a file as the Citation Template or a Shared Partial only inside the
template folder, where the registry scans it. A same-named note elsewhere
uses the Profile tabs. The Partial name appears in the tab title and render
faults. The built-in Default Profile draft also uses the Profile tabs.

Keep the normal clipboard actions in the selection menu. Offer Extract to
partial when the host can write files. Write the new Partial in the source
language and open it beside the caller. Replace the selection only after a
successful write. The name prompt searches using folded text and describes
the file it will create. Refusal leaves the prompt open for correction.

Remember the last nondefault caller and Profile by Partial path on this
device. Workspace state restores an open leaf, while device state also
handles closing and reopening the file. A renamed or unsaved Partial has
no remembered choice and starts with Note. A return to the default removes
the stored entry. This preference stays off vault sync.

Use one registered name for the Citation Template across hosts.
Build example references on demand and keep the example chooser's
order stable.
