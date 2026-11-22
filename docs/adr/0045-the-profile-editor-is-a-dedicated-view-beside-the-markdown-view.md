# The Profile Editor is a dedicated view beside the Markdown view

> Amended 2026-11-06: Fields and Preview are side panels of the Template Workbench View, and the Template Data Explorer is a standalone view with no editor link. [ADR 0081](0081-fields-and-preview-are-side-panels-of-the-template-workbench-view.md) supersedes the companion-view rules below, including the 2026-09-09 and 2026-09-10 amendments.

> Amended 2026-09-10: Item and Annotation selection can start in any linked view and propagates to the other linked views. Each receiver owns its state under the existing association, pin/follow, and restoration rules. Independent workbenches retain their own selections. Annotation fields and previews use the chosen Annotation with its own parent context; the note's Item stays selected. The native Explorer's initial selection list includes built-in examples, chosen explicitly.

Native titles put the selected data before the Preview or Fields role. Annotation titles identify type, page, and excerpt; built-in data is labeled Example, and no selection uses the generic view name. Full panels expose selection in native header actions; sidebars retain a small local selection trigger. Reload preview data in pane menus rereads the available fields, annotations, or built-in examples for the current selection. Automatic refresh continues, and preview rendering follows the selected live or on-demand mode. The pane menu provides actions in both layouts and holds the Profile Editor's Open template workbench action. CSS selectors on native sidebar containers determine layout, with no JavaScript viewport or layout state. These presentation rules retain the existing per-view ownership, association, pin/follow, and restoration policies.

> Amended 2026-09-09: Customize opens a separate Obsidian window with Data Explorer, Profile Editor, and Note Preview in three columns linked through native Linked with tab. Open template workbench also reaches this layout from a compact editor and preserves the same editor and history. Native groups determine linked companions' context; unlinked, unpinned companions follow the active editor like Outline. Ordinary file opening and layout restoration bind existing views. Companion reopening remains explicit. Native groups provide the association in place of a custom workbench identity.

Customize creates or opens the Default document before editing is enabled. A creation failure stays at that action with readable built-in source and an explicit retry. Closing without edits keeps the created customization. Existing files retain native autosave, merge, and File Recovery behavior; Preview and Run still use the current draft before save and during save failure. This replaces first-edit materialization, whose failure path retried on every edit and left an unpersisted editable draft.

Concurrent customization opens the existing document when another attempt creates it first, preserving that document's contents. Default retains its identity, fallback role, and bindings in plugin settings. Restore built-in remains the existing explicit action with its confirmation. File Recovery is the native optional core-plugin protection; routine editing continues to use TextFileView's persistence behavior.

One Profile document has one live text value across editors. Profile Editor publishes and consumes native `quick-preview(file, data)` alongside Markdown views, and Preview consumes that source without an editable controller. Incoming source updates preserve each editor's own history and selection. Each workbench keeps its Item context even when another workbench edits the same file. Live rendering keeps the shared scheduler's quiet period; Run uses the current draft immediately. Vault events reconcile saved content, external edits, renames and deletion, while metadata-cache events refresh metadata-dependent output. An older file read cannot replace a newer live input.

Preview and Explorer remain ItemViews and join the editor through native leaf groups. The group supplies association and native link/unlink controls; each view applies source and context inputs to its own store. A small shared lookup follows the first eligible linked editor in native group order, or the app's active file editor when unlinked and unpinned. Native pin behavior holds the current context. Groups can span windows, and moving an already-linked editor preserves its group. If the linked editor closes while both companions remain, retain their last context and make editor-dependent actions unavailable until the user relinks or unlinks. Native FileView navigation remains in effect when a user manually adds other file views to the group.

Context changes and field-insertion requests are concrete workspace messages. Group/follow rules scope context delivery; the target editor resolves insertion against its own current selection and language. Receivers apply context locally without echoing it. Subscriptions stay with each view and recheck native association after group, pin, active-editor and layout changes. Native group restoration follows view-state restoration, so binding waits for layout readiness and deferred peers. A newly bound companion receives current source and context; its own persisted descriptor supplies reconstruction when no editor is available. The persisted and ephemeral state hooks are defined in [ADR 0044](0044-workbench-ui-is-headless-and-hosts-own-the-look.md).

A fresh native opening without an explicit launch Item starts without an Item. Restore a saved selection by identity; an unavailable Item shows a selection action. An Item picker opens only from an explicit user action. Keep configured names and Properties visible before preview data exists. Annotation examples retain their independent selection and fallback rules from ADR 0041, and the web keeps its labeled Sample Items. Repeated workbench opening focuses the existing workbench; closing a companion keeps it closed until explicit reopening. Moving an editor preserves its controller and history and updates its CodeMirror document root; the destination native window receives focus.

> Amended 2026-09-08: both hosts render on the calling thread with no deadline; the web render Worker and the scheduler's deadline are removed, because the real note creation has the same exposure and the protection guarded only the milder host.

Map [#835](https://github.com/aidenlx/zotlit/issues/835) first framed the Obsidian port of the web Workbench as CodeMirror extensions mounted inside Obsidian's Markdown view, with forms, preview, and explorer staying web-only. Decided in the Profile Editor grilling (2026-09-07): the Profile Editor is its own main-area view, a `TextFileView` subclass with its own view type, opened on a Profile document by Customize, a file-menu item, a command, and an "Open in profile editor" header action on the Markdown view. Inside it runs the shared master/slice document controller from `@zotlit/workbench/document`, so the tabs, Properties rows, Match tab, and Advanced slice work exactly as on the web with one undo history. The view autosaves the way Obsidian saves any note; an invalid document stays invalid on disk with its diagnostics in Problems and on the settings row, which is what [ADR 0031](0031-a-literature-note-profile-is-its-document.md) already allows for a hand-edited file. External changes to the file arrive as one controller transaction that keeps the undo history. The explicit Open template workbench action moves the same editor leaf into a separate Obsidian window, preserving its document controller and undo history. Data Explorer and Note Preview occupy sibling columns on either side. Customize opens that linked layout directly. Companions use native Linked with tab groups; unlinked, unpinned companions follow the active editor like Outline. Ordinary file opening and workspace restoration bind the views that already exist. The user opens or reopens companion views through explicit actions. The Note Preview renders through the plugin's real template pipeline with the Explorer's inert resolvers and displays through `MarkdownRenderer`, sharing only the result contract with the web renderer; in update mode it shows the real Literature Note with its managed parts replaced when one exists.

## Considered options

- **Augment the Markdown view with the shared extensions**: keeps one editor, but the master/slice model cannot run inside Obsidian's single editor, so Properties rows and the Annotation tab would need a second implementation.
- **A split pane inside the view for the preview**: mirrors the web, but takes the pane choice away from the user; Obsidian's leaves already give move, pin, and close.
- **Explicit Save with the web's blocking rule**: a second save model in the same app; the blocking rule is now recorded as the web's connected-Save transport rule in [ADR 0032](0032-web-workbench-edits-one-source-document.md).
- **Reusing the web renderer in Obsidian**: no Eta, no CSL, and a Markdown renderer that is not Obsidian's; the preview would lie about wikilinks and citation styles.

## Consequences

- The Markdown view remains a full editor for the same file; the two views are one click apart.
- The JavaScript Templates gate governs rendering only; the Profile Editor edits an Eta or `js` document at any time.
- Built-in inspection is read-only. Customize creates `zotlit-profile.default.md` before editing, which is the Eject; an existing customization opens its current document.
- Run/Stop in the Note Preview pauses live rendering; a render in flight completes, because the pipeline runs on the main thread.

## Template Data reads

Expose Template Data through one service tag so view atoms need only that tag. A preview can substitute its Profile settings and scope Note Index lookups to the selected Literature Note when several notes share one Item.

Read under a scoped Snapshot. For a key that names an Attachment, Child Note, or Annotation, resolve its owning Item within that Snapshot. Keep the missing-attachment and missing-parent outcomes distinct. Reuse an Item that was fetched during resolution. Read the parent's display reference when only its numeric ID is known, then use its Indexed Key to fetch the Item. Preserve read or build failures for the caller, including errors thrown by synchronous Template data getters.

Resolve preview links without writing. Use source file links when attachment import is off. When import is on, use the configured vault folder or the selected Literature Note's attachment folder. An unset folder and absent note leave no import target. Build synchronous resolvers over the host services so Template getters can call them during rendering. [Template Data](../../packages/notes/src/desktop/template/data.ts)

### Open and unload

Serialize leaf creation for the Template Workbench View and Template Data
Explorer at workspace scope. A second open sees the leaves the first one
created. Failure or cancellation releases the turn.

Run actions from Obsidian callbacks on the plugin bridge so unload can stop
them. Log failures and show a notice, and let interruption end quietly.
Report when a document uses Eta or JavaScript fields that only the native
editor runs. Report when the selected note cannot update from this editor.

[Layout turn](../../packages/template-workbench/src/core/editor/layout-turn.ts) ·
[Workbench actions](../../packages/template-workbench/src/desktop/editor/actions.ts)

### File lifecycle in the Workbench view

Give each loaded file a fresh editor tree. Let Obsidian's TextFileView own the native save path and three-way merge, including unsaved input from peer edits. Serializing writes prevents the native save from returning early while another write is active. On close, interrupt reads and other leaf work, and wait for writes that have started. When the normal load is pending, intercept the first saved-baseline write to reject a read made stale by an edit, a changed baseline, a different file, or interruption. Keep native methods bound to the real view so their private fields still work. Retry against current state when the same file remains active, with the merge enabled if the draft changed. Restore saved view choices before asynchronously loading the file so choices made during the load win. Materialize the Default Profile before enabling edits and join any materialization already in progress.

Update uses the note that opened the leaf. Use the Default Profile's bindings
for Name and folder when the current Profile supplies none. In settings tests,
the folder read signals that the same settings event reached the view.

[Desktop model](../../packages/template-workbench/src/desktop/view/model.ts)

A launch entry point that cannot open its editor shows a notice. Starting
from a note does not establish an update target when that editor cannot
update the originating note.

The desktop Customize case starts from an existing Default document.
It verifies the original note association and Preview in the editor's
native window. A customized Annotation callout appears once per
Annotation when the template lists them. The dedicated walkthrough
starts from a searchable Item without an existing note, exercises a
slash in the note name and a folder override, and waits for the saved
Profile document to compile before asserting its output. The built-in
name can use a YAML block scalar. Profile management stays in the
row's More actions menu.

The dedicated-window test opens from both a Profile's Markdown view
and a Literature Note. The latter carries its resolved Profile and
the note to update. Each document gets one Workbench leaf. A repeat
open reveals the same window with Preview shown. Close the source
tabs so they do not change the next case's root split.
