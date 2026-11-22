---
status: superseded by ADR-0100
---

# The web Workbench is public and standalone, with optional local data access

> **Superseded by [ADR 0100](0100-the-web-template-workbench-is-retired.md).** The web Workbench at `/workbench` and its local data access are removed.

> Current release scope is amended by [ADR 0046](0046-customize-is-a-chooser-between-the-web-workbench-and-the-profile-editor.md#current-release-amendment--2026-09-08): `/workbench` remains reachable by direct URL, with public links and its sitemap entry removed and `noindex` set. Obsidian integration is behind a build flag that defaults to off.

The web Workbench is served publicly at `/workbench` in `apps/docs` and renders
Liquid templates and JSON-e Properties in the browser so authoring works without
Obsidian. A temporary connection approved in Obsidian supplies selected Item
data, bounded template and citation-style
dependencies, and optional access to read and save one Profile document;
standalone users import and download files. JavaScript authoring and execution
remain Obsidian capabilities, while connected saves validate the Profile and
check its loaded revision before writing the exact source through the vault.

The web host rejects Profiles that require Eta or `js` Properties, including
required Eta dependencies, for editing, rendering, and connected Save. It
preserves their source for download and directs the user to Obsidian. This is an
explicit web-specific restriction on the shared editing model from
[#930](https://github.com/aidenlx/zotlit/issues/930#issuecomment-5472788830), whose
general rule permits valid source to survive preview failures; supported web
Profiles retain that distinction between validation and preview errors.

Obsidian offers entry from a Profile row and the current Literature Note. The
browser keeps drafts and snapshots usable after connection loss or a version
mismatch, while local reads and vault Save wait for a compatible connection.
Opening built-in Default stays in memory; its first Save creates the document
only if it remains absent. Save changes the Profile document and leaves existing
Literature Notes unchanged.

These decisions come from the [#931 design interview](https://github.com/aidenlx/zotlit/issues/931).
The [contract](../research/issue-931-web-workbench-contract.md) records the
operation table, validation boundary, and prototype evidence.

The Workbench design review uses a copy of the bundled Default Profile with a distinct id so reviewers can exercise the Match tab on an editable Profile. [Review Profile helper follow-up](https://github.com/aidenlx/zotlit-repo/issues/103)

The public Workbench route prerenders its frame as a skeleton and does not invoke the Worker. Start the browser-only editor import at module evaluation so the document core, editor, and renderer can load while hydration proceeds. The prerender does not start that import.

## Shared Workbench controls

The docs kit adapts shadcn Base UI controls under `apps/docs/src/components/ui/` to the site tokens. Keep native focus and Base UI's tab keyboard behavior and panel association. Button and input variants express the 32 px Workbench row and the button variants include a 28 px segment and smaller icon-only affordances for rows and chips. The switch keeps a 40 px pointer target. The dropdown, select, dialog, and popover share the editor's compact surface and hover-card cues. Dropdown links leave navigation to the browser. Check items show the state in their icon slot. Use the shared toast manager and let a surface change the end inset with `--toast-end` so the Workbench can keep toasts clear of Fields.

## Browser drafts

Autosave stores the source, the active sample, and the annotation choice under one document reference. A connected reference is scoped to its vault installation. The storage adapter keeps persistent and tab-scoped data separately, so the draft can still be offered with the sample data available on a later visit. Each change restarts the autosave delay.

Read the previous draft before autosave starts, and suspend autosave while the restore prompt is open. Treat the first user edit or sample change as Start clean so restoring cannot overwrite the user's new work. A sample recovered as part of page initialization updates the prompt's baseline without dismissing it.

## Editor interactions

CodeMirror owns the completion query, keyboard input, and focus. React draws the template suggestions in a Base UI popup. Anchor it at the start of the word so it stays still as the user types. Use the current CodeMirror selection index to update the active descendant and scroll the option into view, because the Command component updates its selected attribute in a separate effect. Defer unmounting the popup root until the next microtask so the parent React commit can finish destroying the editor first.

Use a CodeMirror theme for the expression suggestions' list box and selected row. The editor's unlayered base styles take priority over the site's layered utility classes. Let the pane draw the focus ring. Keep the Advanced editor's annotation marker extension in a separate module so the annotation components remain a Fast Refresh boundary. Read the marker from the current editor buffer so it follows an unsaved change to the section boundary.

Resolve hover data when the delay expires because changing the sample does not require a CodeMirror transaction. Delay dismissal briefly when the pointer leaves the editor so it can cross the gap to the card.

## Rendered results

Run the shared Profile renderer on the page thread, where it uses the browser runtime. One cached Temporal load serves rendering, Match data, and field display. Load the Reading view after a render completes. All result panes use the same lazy import so the Markdown parser stays out of the initial editor chunk.

Keep the parser-specific node shapes in the Reading view and expose its parse result to tests through that boundary. The Reading view hides Obsidian comments, omits math rendering, shows task state without editing it, and replaces navigable targets with inert marks or file-type placeholders. The sample contains no vault files. Render supported elements through an explicit map and keep only the children of unsupported elements because template output is untrusted. The Markdown view provides the exact output when the Reading view is approximate. The Reading view groups the blocks of each rendered annotation. Keep the parser's positionless separator inside an annotation group when it falls between blocks in that group.

## Draft storage and file handoff

Keep the draft source and its expected revision in local storage. A bundled sample may share that record. Keep vault snapshots in session storage, so the public origin has access to that data only for the current tab. A reload in the same tab can restore both parts. When a new tab opens, the user can recover their source without the vault snapshot. Validate stored records before using them, and fall back to the draft without a snapshot if the tab record is missing or invalid.

Access each storage property inside the guarded operation because a browser can throw as soon as the page tries to access denied storage. A storage failure leaves the editor and source download available. [Autosave feedback follow-up](https://github.com/aidenlx/zotlit-repo/issues/118)

Label incomplete downloads as drafts in the filename and omit the Profile ID when parsing cannot establish one. For a handoff, copy the source before opening the native import sheet. A transferable copy of Default retains the same new ID for the life of the editor so the next handoff can replace the imported copy.

## Page lifetime and editor state

Give each page one editor, atom registry, and Effect runtime. Build services on first use, so a render discarded by Strict Mode does not start them. The page owns the bridge launch. Schedule registry disposal after the commit so Strict Mode can release and retake the page without interrupting its work. When the last hold ends, disposing the registry interrupts the page's remaining reads, renders, and commands.

Keep the web host adapter stable across React renders. Its callbacks read the current data and controls through a ref. A cancelled confirmation or picker clears its overlay. When Fields closes, return focus to the header's Fields action. If browser storage is blocked, the current page can still use its in-memory preferences.

All editor surfaces share one chosen Item read. Wait for Temporal before exposing the sample data or evaluating Match, since an expression can use the current time. Evaluate Match in memory over the page's one Item. Keep the last successful preview while the next source is invalid, the host refuses the Profile, the required dependency bundle is stale, or the next Item is still loading. Report render failures against the Annotation root when that tab shows its example. A Profile's declared sample item type can choose the corresponding bundled sample, while a connected Item stays selected.

## Web frame and browser controls

The skeleton and live page share the frame and panel properties. The skeleton draws an inert Preview column while the browser loads the editor and measures the frame. Keep the frame free of imports from the live editor so the prerender chunk stays small. Subtract the site banner from the viewport height. Below 780 px, give the page a minimum height of 44rem and let it scroll. The wrapped header and stacked Preview then leave room for the editor's 320 px minimum. Place Problems based on the editor pane's own dimensions. A hidden frame can report zero size, so keep its last usable measurement.

Keep the editor and its controls in one scroll region. Let the source grow to fit its text, and scroll within the region when Problems or Preview reduce the available height. A reveal scrolls the selected source into view. In Problems, give only the explanation a scroll area so the controls keep their position. Make that area keyboard focusable. Keep engine excerpts unwrapped to preserve the caret column, and let translated labels wrap inside their controls.

Open Help pages in a new tab so unfinished source stays open, and announce that behavior in the link. Use one file input for the editor and unsupported-Profile handoff screen. Clear its value after reading so choosing the same file twice triggers a second read. Download the exact source, including invalid drafts. Load the Temporal polyfill only on browsers that need it.

The browser Profile renderer does not register Eta dependencies, even
if the connected Local Bridge sends them. Expose the unsupported
dependency in the preview diagnostics. Check a bundled citation style
for the standalone style and layout elements, and report a bridge
failure to resolve it. Leave CSL processing to Obsidian. The browser
Profile renderer returns no separate Citation Template or Shared
Partial output.
[Browser Profile rendering](../../packages/workbench/src/render/index.ts)
