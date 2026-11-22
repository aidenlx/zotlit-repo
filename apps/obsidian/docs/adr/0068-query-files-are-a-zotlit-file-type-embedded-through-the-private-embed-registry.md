# Query Files are a ZotLit file type, embedded through Obsidian's private embed registry

A Query File is a `.zotquery` vault file that opens in a ZotLit tab view and embeds in a note with `![[file.zotquery]]` or `![[file.zotquery#View]]`. Its text keeps the shape of an Obsidian `.base` file (`filters`, `formulas`, `properties`, `summaries`, `views`), and ZotLit Query answers it. Obsidian's public API registers a file type (`registerExtensions` with a `TextFileView`), but only the private `app.embedRegistry` renders `![[x.ext]]` for that type; Bases uses the same registry. ZotLit calls it from one guarded module (`packages/query-views/src/obsidian/query-view/obsidian-private/embed-registry.ts`). When the registry is missing, ZotLit registers no embed and Obsidian shows its own file card, which opens the file. A Query Block saves a toolbar change through the private `ctx.replaceCode` of its code-block context, from a second guarded module (`packages/query-views/src/obsidian/query-view/block-write.ts`), so the Live Preview widget stays mounted; Bases saves its code blocks the same way. When `replaceCode` is missing, the Query Block writes through the public `getSectionInfo` and `processLiveText`, after a check for the previously rendered text at that location, and Live Preview builds a new widget.

Proposed on 2026-10-14 with [#1459](https://github.com/aidenlx/zotlit/issues/1459), which replaces [#1275](https://github.com/aidenlx/zotlit/issues/1275).

## Considered Options

- **A view type inside Obsidian Bases** (`registerBasesView`, rejected): Obsidian keeps the toolbar, filters and file, but each row is a `BasesEntry` with a vault `TFile`. Zotero Items, Attachments, Annotations and notes are not vault files, and a Bases view cannot add its own data source, fields or functions.
- **A Markdown note that holds a Query Block** (rejected): public API only, but the file is an ordinary note in search, the graph and the file list, not a separate object a researcher names and reuses.
- **A `.zotquery` file with a private embed** (chosen).

## Consequences

- An Obsidian update can change or remove `embedRegistry` or `replaceCode`; the two guarded modules are the only places to fix, and the plugin review can flag the calls. Without them, embeds show Obsidian's file card and Query Blocks still save through public API.
- ZotLit builds its own toolbar, sort, group, properties and results controls. The filter control reuses the Template Workbench Match editor, which already writes Filter Expressions.
- `.base` key names are kept where the meaning is the same, so a researcher who knows Bases can read a Query File.

## Query File round trips and table behavior

Use one parser and serializer across Query File tabs and embeds, Query Blocks, and the sidebar. Preserve the unknown YAML keys and their map order when changing a known field. Insert new file filters first and put new Formulas and property settings before the views. Report unreadable entries through file diagnostics so the file still opens. Drop an invalid column width without a diagnostic because width affects presentation only. File-level filters apply to views of the first view's Query Dataset. A default file starts with an Items Table so it has a useful first view even when the Library has no Annotations. Its second view groups Annotations by Item.

A Manual group order is also a visible group list. Omitted values hide their groups, and null names the absent-value group. Changing the grouping property clears Manual group order because the old group values no longer apply. Visible properties follow the saved order. Removing a Formula also removes its property settings and visible columns in every view. A Display Name edit keeps a property's other settings.

Match Bases for Table header sorting and column moves. Cycle from ascending to descending to no sort. The active column goes first and the other sort keys keep their order. A drop takes the near gap at the column's boundary on either side of the source. Store individual widths as positive whole pixels. An absent width uses the automatic size.

## Virtual rows and print

For wrapped List rows, prepare text in batches with Pretext and lay it out at the measured width. This avoids changes to the scroll range as rows enter the window. Reprepare when the font changes or its loaded version replaces the fallback measured on canvas. Cells with other content retain their layout's own height measurement. Virtual spacers provide only the omitted height. Paint faint row outlines on the scroll container so a quick scroll still shows the row positions when the browser cannot draw the rows in time.

Wait for the layout to draw the current store value before printing. The read may finish before Preact draws the new value in a hidden window. Compare the drawn value by identity, use separate latches for Annotation Cards and Item records, and settle pending waits when the view unloads.

Use a cross-platform file name and pick a free numbered name when a Query File already exists at the requested location.

## Properties and result snapshots

Use one inventory of Property entries for layouts, copy and export, and the Properties, Sort, Group, and Filter controls. Prefer a saved Display Name, then the relevant Zotero or dataset label, then the path. Expose nested Projection Paths when searching the property picker. A missing order uses the dataset defaults, an explicit empty order hides every property, and a nonempty order with no fitting properties falls back to defaults. Leave unused settings in the Query File so they become available after a dataset or layout switch. Keep a typed path available for diagnosis and remove a Formula entry once its definition and visible reference are gone.

Replace visible results as one snapshot. A failed run can retain or clear that snapshot. Keep both the distinct rows and their grouped instances. Sort groups by their shown labels with the query collator, leave the absent-value group last, and use Manual group order as the explicit visibility list. When grouping by Item, a standalone Attachment has its own group because it has no Parent Item. Name that group by the Attachment title. The order within a group follows the query. Count an Item once even when it appears under multiple group values.

## Query File edits and note hosts

Each tab or embed keeps its own selected view. The host owns storage and remembers the selected view. The document applies edits on screen first and queues writes in edit order. Typed changes wait for a delay. A menu choice includes any pending typed change in its immediate save, and a host flushes pending text when it unloads. The latest write determines the save status. A failure leaves the change on screen so the researcher can see it. Feed an embed's edits through the open Query File tab when one exists. This keeps the tab current and prevents its next save from overwriting the embed's change. The tab waits for each real write because Obsidian's save method returns early when another write is in progress.

A note host binds `this` from the Properties in the metadata cache because Live Preview's block processor does not supply frontmatter. A Query File tab has no note binding. A Query Block edits its source note when the context provides a section, including in section embeds and hover popovers. On unload, save against the last known opening fence in the original note because the editor may already show another file. The closing fence supplies the final line break. Show text when a block occurs inside a Query View so nested views cannot start queries. A Template Workbench note preview shows a placeholder because it has neither the final note's Item nor a save target. Preview detection uses the host element's ancestors because Obsidian adds the section to the preview before running its processors.

Defer note queries until their elements come within one screen of the note's scroll container. Use the observer from the host window for pop-outs. A print starts all those queries and waits for the first draw. A host reserves its last drawn height in this session so Live Preview can rebuild it without moving the surrounding text while it loads. The height reservation lasts until the Layout draws. A new host reserves room for the toolbar and one row. Keep the scroll position as the note takes a far-offscreen host off the page.

Obsidian's unlayered Markdown styles also apply to Query View tables, paragraphs and lists inside notes. Use `revert-layer` on the Layout's own elements to recover the plugin styles. Limit the selectors so Markdown rendered within a cell keeps the note's styles. Use interface typography for controls and keep note typography for rows. Leave room for Live Preview's sibling edit button. The Query File tab removes the host's top and side insets for full-width controls and keeps the bottom inset to clear the status bar.

Delay the empty-tab command patch until the layout has leaves. A plugin unload before layout readiness cancels installation.

## Obsidian adapters

An embed or Query Block has no Workspace Leaf of its own, so Obsidian's keymap will not take its Scope from the active leaf. Push the Scope during capture of a focus event so controls inside the view can push their own Scope above it. A text entry can keep its own Scope. Preserve the last focused view while the command palette is open so Annotation History commands can reach it. Stop drag propagation so Live Preview does not substitute the link that embeds the view for the card being dragged.

Detaching a note's Query View can reset its scroll position without a scroll event. Observe scroll events in capture because they do not bubble. Restore positions when the view has a size again. Keep one mapping from Query Context to bound records and hints so hosts only need to identify their surface. Return stable lists of bound records so callers can memoize against them.

Patch the empty view's `onOpen` after the host fills its action list. Insert the ZotLit command after the host's enabled new-file actions and create it in the same window. Match the host's keyboard behavior, including its checks for composition and already handled events. Verify the placement against the host's actions in the End-to-end Run. If Obsidian exposes no matching view, leave its default actions available and log the missing adapter. On plugin reload, remove a prior Query File embed registration first because duplicate registration throws.

Read assigned property types and suggestions through the same private managers as Obsidian's Properties panel. When a manager is unavailable, infer a property's type from values and keep editing available without suggestions. When the suggestion adapter cannot clear the default highlight, wait for typed input before opening the popover so Enter cannot select an unchosen value.

For long Item Layouts, keep the virtual rows in normal flow so tables retain row layout and lists retain their markers. Keep the selected, first, and focused entries mounted for keyboard navigation. Use the Layout's own scroll box in tabs and notes, and draw all rows for print. Disable browser scroll anchoring and the virtualizer's size compensation because replacing a spacer with a measured row can move content under the pointer.

Use fractional heights so rounding errors do not accumulate above a row brought into view. Keep the last height for hidden rows. Defer measurements during manual scrolling to keep the scroll range steady. Measure during a programmatic reveal so the row lands below the sticky header. Estimate unmeasured rows from the median of measured rows of their kind. Learn each kind across draws, then stop sampling it. A changed estimate replaces the key callback because TanStack's measurement cache tracks that callback's identity. A change to the layout or its host window invalidates measurements. Detach the scroller for one draw after a window migration so the virtualizer observes the element from its new window. Update the list's scroll margin when the sticky header, scroll position, or scroll box size changes.

## Toolbar edits and reads

Keep saved Manual group entries that have no matching row at the end of an edited order. They can become visible again when the query returns matching rows. The host stores Sort and Group edits. The controls work with settings and rows passed to them.

Search filters the rows already returned by the Query View. Keep the search input in its own toolbar row and give it an accessible name independent of its dataset-specific placeholder. Closing the row clears the search and returns focus to the toolbar button. Subscribe to filter suggestions and custom field names only from editors that use them, so the reads stop when the last editor unsubscribes.

In Configure View, a valid name is applied on blur or page exit. Save it through the document's typed-edit path and update the page's name immediately so it stays on the same view. Apply layout and dataset choices as immediate document edits.

## Formula edits

Use the Template Workbench expression input for Formula text. Check syntax as the researcher types and apply a valid edit after a delay, on blur, or when its page closes. Use the timer of the editor's own window. Query runs supply engine faults, which the field shows only while its text matches the saved expression. Omit the edited Formula from completion to avoid offering a self-reference, and omit Vault Properties because the Formula runs without the vault.

Check that the Formula still exists before applying a pending edit to its text or Display Name. This prevents the page's pending save from restoring a deleted Formula or its settings. After Add Formula succeeds, replace the page with the new Formula's Property page so editing can continue. The Query View Properties End-to-end Run covers Formula feedback in the popover, and the shared expression-input tests cover Fault placement.

Read Vault Property names from the Literature Notes and allow an unqualified name to add a Vault Property in an Items view. Show its path with its label to identify the source. Sort offers the dataset engine's sortable fields. Group offers the Layout's group paths. For a list property, keep the list-member path for grouping and use the parent field for its label and icon.

Keep Table first among the Layouts that can draw Items so new Items views have a stable default. When changing datasets, keep the selected Layout if it fits and choose the first compatible Layout otherwise. Preserve the stored properties, filters, sorting, and grouping so a later dataset switch can use them again. Report an incompatible filter through the filter diagnostic. Reserve the embed link delimiters `#` and `|` in view names.

Use one registry-backed model per host. Host controls subscribe to its registry directly so they can read the same model outside the Query View tree. Run table actions through the owning leaf so vault and workspace actions use its task runner.

Use the same text conversion for Layout cells, Search, clipboard, and CSV. Read Vault Property cells again on note updates without running the Query again. Preserve the live cell for a Vault Property or Error Value so the layout can show an editor or a diagnostic. Use the enclosing Literature Note for its own Item when resolving Vault Property values in an embed.

The Cards Layout follows Bases. Use the first visible property as the title and give later properties their own label and a smaller value. A missing value takes one line with a dash. With no visible properties, show an empty card. The minimum card width controls how many cards fit across. The List Layout uses one list for all groups and restarts numbering in each group. Headings stand outside the marker indent. Use the same cell split for markup and text measurement so the estimate tracks the lines the row will draw. Measure rows with non-text cells from the DOM.

Keep a virtualized list at the height computed for its rows and header so the scroll range stays steady while entries mount. Measure the sticky Table header to place a revealed row below it and start the scrollbar under it. Use the window's background outlines for omitted rows and cover them with the host surface where rows actually draw. Reset Obsidian's unlayered button styling for group headings so the toggle can inherit the surrounding text size.

## Table Child rows and export

Use one Table Child Source per kind of Child row. Attachments and Child Notes appear under Items, and Annotations under Attachments. Derive the expected rows from the parent projections. The Child Note projection includes titles, so it supplies those rows directly. Read only the sources whose marker lists have entries. Reserve space for every pending row and delay its loading text to avoid a flash on fast reads. Leave a page number inside an Annotation's link so an image without text still has a target. Open Zotero Child Notes through their Zotero link. Attachment and Annotation links use Obsidian's modifier gestures and retain the Zotero URL for drag.

Use one Table body per Item, including its expanded rows and the group heading when it starts a group, so virtualization measures them as one entry. A Vault Property cell lets its editor open over the rows below while the displayed value clips to the column.

Export rows in view order with visible property labels as column headers. A view with no visible properties exports an empty table. End clipboard TSV at the last cell so spreadsheet paste does not add a row. Preserve embedded line breaks inside quoted cells. Include an HTML table for rich paste.

## Query View lifecycle

Tabs, embeds, Query Blocks, and the Annotation View share one Query View. A host can delay its first run, as a note host does until it comes near the screen. While waiting, keep the latest requested run and let callers await it. The view's task runner interrupts table actions and reads on unload. A collapsed row can stop its own read early.

Rerun when a planned request changes. Reuse its result for presentation changes such as a new Layout or view name. Draw the result with the current Layout because the Layout can change while the query runs. When a host-only change leaves the request intact, publish a new record list so the Layout can read the new host metadata. Clear the old snapshot for another Query Context or Library unless the host updates the bound label and rows together. Preserve a compatible snapshot on refresh failure, including its warnings and Formula marks. A filter that depends on an invalid or missing Formula clears the previous rows. Show the fault at its condition when the planner can locate it.

Use the view's window for its timers. Debounce reruns on live Annotation list changes. The live list can contain a new Annotation before Zotero's database returns it. Keep the cards on screen in this interval and take the subsequent database-triggered rerun. Separate layout draw completion from query completion for print, including when a hidden window draws a store update later.

Export visible Vault Property values and omit the Literature Note link column. Replan when frontmatter changes which keys a Vault Property condition keeps. A host supplies the empty-state wording when it applies its own conditions. Recheck save availability as the phase changes because a note host may only know its position after mounting.

In a note, cap the Query View body and let its rows scroll within the Layout. Print every row with the toolbar hidden. Keep the Layout mounted while a status frame replaces it so it retains scroll and column widths. Name the toolbar from a hidden element to avoid an Obsidian tooltip.

### End-to-end view proof

Identify a Query File embed by its link text and zero-based
occurrence. Identify a Query Block by its zero-based block number.
An internal-embed element can show a Query File or a Query Block
from a linked section. Reveal the selected view in the most recent
leaf for that note. Reveal one at a time because it scrolls the
note. Allow the first draw to span multiple calls after opening a
note. Report an absent note or target immediately and retry
transient rendering failures. Return the last failure when retries
end.

Verify Query File creation through the command palette, folder
menu, and native empty-tab pill. The pill mirrors Obsidian's
private empty-view markup, placement, and hotkey treatment. A
click creates the file in the same tab and selects its title.
Check Table ordering, Annotation grouping and counts in the
Fixture without Zotero, and context diagnostics in a tab where
`this` is unavailable. Use separate cases for malformed expressions
and unknown fields.

[Note Query View helper](../../../../packages/e2e/src/note-query-view.ts) ·
[Query File cases](../../../../packages/e2e/src/query-file.e2e.ts)

### Properties, exports, and layout proof

Without a saved order, list the dataset defaults as visible. Hide
all clears them and each later tick appends a column without
moving rows. Place visible properties first when reopening. A
row limit changes the rows on screen while preserving the full
match count. Export the displayed rows in column order. CSV uses
a UTF-8 byte order mark and CRLF. Clipboard TSV uses LF between
rows and no final newline. Use a JSON envelope to inspect exact
clipboard text across the CLI. Poll for the clipboard write.
A field uses its label and a Formula its path when no Display
Name is set. Export uses the same names and turns an Error Value
into its diagnostic message.

Escape from a Property page saves the edited Display Name and
restores focus to the search field. Search matches Display Names
and starts empty on reopen. Removing a Formula removes its name
without changing other fields. The Literature Note column can
be moved, sized, hidden, and restored like another Table column.
A layout that cannot use it leaves the Table setting intact and
does not report it as unused.

Switching Query Dataset keeps incompatible grouping in the file
and marks it unused until it applies. Verify expansion against
Query results. An Item lists Attachments before its non-trashed
Child Notes. An Attachment expands to its Annotations. Open PDF
links with the native modifier and middle-click behavior and
read the Table again from its own leaf after the PDF takes focus.
Use an Annotation Anchor to land on the mark. Host-incompatible
files such as web snapshots open through Zotero. A Create action
prompts when multiple Profiles fit, and the resulting link
appears in the row.

Close the tab before restoring Fixture text so its pending save
cannot overwrite the restore. Close leftover popovers during
teardown. Group List and Cards views by the same hidden fields
available to the Table.

[Properties cases](../../../../packages/e2e/src/query-view-properties.e2e.ts) ·
[Table cases](../../../../packages/e2e/src/query-view-table.e2e.ts)

### Embedded long list proof

An embed keeps its scroll length while rows mount, stays within its
height cap, and scrolls inside the note. Use the visible mode's
embed because Obsidian can leave the other mode's embed mounted and
hidden. Folded views reserve the capped room and defer queries, as
do views in the hidden mode. Export to PDF lifts the cap so the
document can print all rows.

Sample every frame while a Query Block rebuilds after leaving its
source in Live Preview, switching note modes, or saving a toolbar
change. A rebuilt block is a different element. It keeps the
settled height, or the old or new settled height when the toolbar
changes the row count. Keep the header fill opaque with the callout
tint. Scroll a long note until its embed leaves the page, then
return. The embed keeps its own prior scroll position.

[Embedded long list cases](../../../../packages/e2e/src/library-view-long-list.e2e.ts)

### Query Block, print, and view switching proof

Drive Obsidian's own PDF Export modal with the save path and read
the rendered page in its hidden print window. Bound the wait for
a query that draws no rows. Use a separate note for each cold
mode test because a view's settled height survives in the
session. Sample text below a block from open through the first
draw. It can move downward once when the view settles.

A toolbar edit rewrites only the block and keeps the Live Preview
widget. Reading view follows a changed note Item key, and a
section embed saves to the original note. Without a note key,
show the Query Context diagnostic. Closing before a delayed
save and restoring text are distinct test conditions. Use the
visible block because Obsidian can keep another mode's hidden
instance.

The view menu searches view names. Adding a view opens its
configuration on the name. A context click or chevron can edit
another view without switching the displayed one. Making a
view default moves it first and a plain open selects it. Offer
only layouts for the dataset. Switching layout preserves rows,
grouping, and limit. A numeric page label takes a prefix and a
named label stays as written. Turning labels off updates the
cards immediately. Search uses displayed Item Type labels.
Hiding all properties leaves one row or card per Item and no
visible properties. Group by the displayed color name, and
restore saved group visibility on reopen.

Open the same Query File as a tab and as embeds with different
Query Contexts. An explicit section selects its view and a plain
embed shows the first one. A file-level filter saved from any
instance updates the others, and Results stays local to each
instance. Clicking a Live Preview embed does not move the note
selection. Use a bounded observation to prove this because no
event reports an unchanged selection. A hover uses the file's
first view and the embed link opens its current view. Label IDs
must be unique across separate Preact roots so pressing a label
focuses the matching embed's input.

[Query View cases](../../../../packages/e2e/src/query-view.e2e.ts)

Check editor and drag actions on cards in the Query File
Annotations view and in a Literature Note embed. Scroll the
embed into view when it is below the Query Block because
Live Preview can defer drawing it. Dragging an embedded
card into the note follows the same insertion behavior
as a sidebar card.

[Paired Query View cards](../../../../packages/e2e/src/paired-run.e2e.ts)
