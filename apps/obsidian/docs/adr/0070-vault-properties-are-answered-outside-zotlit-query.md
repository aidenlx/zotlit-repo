# Vault properties are answered outside ZotLit Query, and `limit` counts the rows the researcher sees

A Query View property `vault.<name>` is a vault property: the value of the frontmatter key `<name>` on the Item's Literature Note. The Literature Note Property, `vault.literatureNote`, is the first of them. The plugin answers vault properties from the vault; `@zotlit/item-query` never reads them. The Query View leaves every vault property out of the fields, the sort and the filter it sends to ZotLit Query, and its request planner keeps the vault sort keys and the vault conditions apart from the engine request.

`limit` counts the rows the researcher sees. ZotLit Query applies the filter, the sort and the limit itself and hydrates only the rows it returns, so a vault sort or a vault filter is planned before the engine runs: a vault sort runs the request without a limit and truncates after it sorts, and a vault filter becomes an inclusion or exclusion list of Indexed Keys in the engine filter. The plugin never sorts or filters the rows of a limited query after they come back.

Proposed on 2026-10-17 with [#1531](https://github.com/aidenlx/zotlit/issues/1531).

## Considered Options

- **A vault dataset or a vault field inside `@zotlit/item-query`** (rejected): the engine reads the Zotero database in a worker and has no access to the vault's metadata cache; it would need a second data source and a new request shape for one plugin feature.
- **Sort or filter the returned rows after the engine runs** (rejected): the engine has already applied `limit`, so "the first 20 unread" would show fewer than 20 rows, or the wrong 20.

## Consequences

- A vault predicate must be a top-level `and` condition of a view's filters; the planner takes these apart from the filter ZotLit Query runs. A vault predicate that cannot be split from the Zotero part gets a diagnostic instead of a client-side evaluation.
- A vault sort over a large library stops at a fixed cap of engine rows and shows the truncation indicator.
- Later work on `@zotlit/item-query` keeps `vault.` out of its own namespace.

Split the top-level conjuncts that must hold for every row. A vault read can use dot access or a literal bracket name. A read that depends on Zotero data, Query Context, a computed property, or a nested disjunction cannot be evaluated separately in the vault. Walk every operand to find its vault references. Keep original condition positions when composing the engine filter so a diagnostic can mark the right text in the Match editor. Append a generated Indexed Key condition on a separate line so a long key list does not obscure the excerpt.

Display a value as a link when the whole string is a link. Show Tags without their leading hash. Use native date fields with the same date and date-time forms as Obsidian Properties, and represent a cleared field as null.

## Planning and sort order

Evaluate vault conditions before the engine runs. Read each Literature Note and also evaluate with null values to represent an Item without a note. If the absent note fails, use an inclusion list so the engine can seek candidate Indexed Keys. If it passes, exclude the Items whose notes fail. Compare Parent Item keys for Attachment and Annotation rows. This lets the engine apply the row limit to actual matches.

Substitute frontmatter values as Filter Expression literals. Treat unsupported values such as maps as null. Evaluate identical substituted text once per plan. Map a fault that touches a substituted literal back to the entire original property read. Cache the vault filter by its conditions, Item key path, and enclosing note. Invalidate it on Note Index changes. A Query Context change alone reuses the cached filter.

For a vault sort, request up to 5,000 matches and the projected Zotero sort fields. Use the engine's row order and projected sort keys to rank equal Zotero sort prefixes. A partial date uses its first day as its key, for example. Compare vault values in the shared scalar order with empty values last in either direction. Preserve the engine order for complete ties. Apply the displayed limit after sorting, within each group, and keep counts from before that limit.

Exclude vault properties from engine projections. An Items Table can include the Literature Note Property as its final default column. A layout that cannot show it keeps its saved position for a switch back. Reserve Obsidian and ZotLit system keys from editable vault properties. Name a vault property by its frontmatter key and identify it as coming from the note, since the database may hold a newer value.

Use bracket access for conditions on Vault Properties so names with hyphens remain valid. Compare date and date-time conditions in the text form stored in frontmatter. Track property type updates separately from property name updates so the Filter editor refreshes its operators and icons after a type change.

Build expression completion with the same dataset vocabulary as the planner. Pass the view's Query Context, Formulas, source-specific fields, and Display Names. Cache a vocabulary per dataset so plans for member completion survive typing. Keep each condition diagnostic tied to its section and path, and keep its callback stable until the diagnostic changes. The Workbench vocabulary tests cover dataset fields and the Query View tests cover the host inputs and labels.

Share one Profile-managed key read by note path across its cells. Key the atom family by path so structural hashing does not traverse the cyclic Obsidian file object.

## Editing Vault Properties

Use the enclosing Literature Note for its own Item. Other rows use the most recently modified note for that Item. Read its modification time live because a body edit can change the rank without an index event. With no note, show a placeholder. With a note and no value, show an empty cell. Prefer a supported type assigned in Obsidian. Otherwise infer from the cell value or the first value for that property, with text as the default. Listen for assigned-type changes while frontmatter subscribers are present. Use stable snapshots for property names and cell values so unchanged data does not refresh a subscriber.

Opening an editor does not create a note. On commit, use normal Literature Note creation and honor cancellation of Profile selection. Write only the selected frontmatter key through the active editor when the note is open. Keep the key with a null value when clearing it. A Profile-managed key stays read-only because an update would replace it. The cell can render before its Profile lookup finishes, but the write waits for the lookup before updating the note. Treat changes to an assigned type or managed keys as frontmatter changes for the view. Resolve links from the note that supplies the value.

Match Bases by opening the editor over the cell without resizing the row. Scroll the cell below the sticky header first. Expand into the side with more space, and keep that side while the editor is open. Align the editor and preview text. Use an unlayered `revert-layer` rule to remove the input chrome while retaining the native date picker icon. The date preview is inert so it stays in the system date format and the cell handles its gestures. Center a native checkbox without its label margin. Show an indeterminate checkbox for a missing or null value and an unchecked one for false. Place the read-only lock over the cell edge on hover so it does not take a column slot.

Commit on Enter, Tab, or focus leaving the whole editor. Escape drops a scalar edit or an edit inside a list chip. In the list add field it commits the list and the pending item, as in Bases. Ignore the blur caused by a key that already ended editing. Return focus to the cell on Enter or Escape and move it to the next or previous editable cell on Tab or Shift+Tab. Keep one keyboard stop for the list item menus, including a read-only list with Copy available. List items use position because values can repeat. Give the cell and its fields an accessible name from a hidden element so Obsidian does not draw that name as a tooltip across the next row. Keep a link click separate from cell editing and keep cell gestures from activating the row or enclosing Query Block.

Use the host's date, date-time, boolean, number, and string-list forms for frontmatter writes. An invalid draft leaves the value alone. Keep existing repeated list items, and skip an edit or addition that would introduce a duplicate. A comma remains part of a chip's text. Keep the list's chips the same height in the preview and editor so opening or growing an editor keeps them aligned with the rows.

Match property text as a whole case-insensitive substring, including spaces, with the Bases ranking based on occurrence count, position, and length. Use Obsidian's fuzzy tag matching for tags, omit values already in the list, and leave aliases without suggestions. Use the current textarea value because the host's suggester treats the textarea as contenteditable. Leave the list unhighlighted until typing and wait for typing when the host cannot clear its highlight. Shift+Enter accepts the typed value while the suggestion scope is active. Show the remaining list suggestions after a pick and after initial focus. Keep the draft and suggestion callbacks current so a menu opened before a render acts on the current editor.

Use native menus for list items. Anchor keyboard requests to the focused chip or the cell's list menu when a pointer is unavailable. Keep one menu per chip. While the editor has focus, put its key Scope above the Query View's card shortcuts. While a menu is open, let the menu receive navigation and Enter, and consume Escape and unhandled keys so they do not edit the pill beneath it. Move focus before removing a focused pill so the change does not end the edit through blur. When returning to the add field, wait for the new list before showing suggestions. Observe truncation in the chip's current window so it can show the full value as a tooltip after migration to a pop-out.

## Benchmark

Run `pnpm --filter @zotlit/query-views bench` for mixed Vault Property and Zotero queries. The benchmark uses Stress Builds, the production scheduler, and the worker answer path over SQLite. It measures the structured clone separately from the engine and the client Layout. Its Map of fixture notes gives a lower bound for planning time because the real view reads the Note Index and metadata cache. It checks result rows and limits. Timings are observations.

Set `ZOTLIT_BENCH_SIZES` for Item counts, `ZOTLIT_BENCH_RUNS` for measured repetitions, and `ZOTLIT_BENCH_OUT` for the JSON output path. The benchmark can also copy `ZOTLIT_BENCH_REAL` into scratch storage with a read-only connection. Shut down Zotero before measuring its database because the immutable connection cannot read pending WAL writes.

The benchmark builds reusable Fixtures in the scripts workspace so Node resolves the fixture dependencies there. Its statement observer attributes elapsed time, less scheduler pauses, to planning, source lookup, candidate selection, matching, projection, and the tail. It separately times a parse to expose the cost of large key lists. Run a Zotero-only query once per filter setting since note coverage has no effect. Use a direct filter over the fixture notes as the mixed-filter correctness check.

The plugin exposes the live query measurement port only in development builds. The sampler is plugin-wide and uses the main window rather than the window that happens to have focus.

### Table editing proof

Use trusted input to enter edit from any point in a cell,
including an empty one. Align the first editor line with the
displayed value. An unchanged value can exit without writing.
Escape closes list suggestions first. Matching vault values are
available when editing starts. Allow Shift+Enter to keep the
typed text instead of taking the highlighted suggestion. Toggle
a checkbox in one click.

Commit a list when focus leaves from an item. Backspace in
the empty input selects the last item. A pill's menu owns
keyboard actions until closed. Escape closes that menu first,
then releases the pill back to the input. Edit a chip from its
menu and keep commas within the item.

An initial write can create the Literature Note, with Profile
selection when several fit. Verify that a Vault Property
filter and sort operate on the resulting values. The edit
surface grows outside row layout. It opens below a middle
row and above the last row. Check matching long values in both
positions to verify the placement depends on the row. An empty
last-row editor starts at one line and wraps upward.

[Vault Property cases](../../../../packages/e2e/src/query-view-table.e2e.ts)

For a long embedded Table, check that a last-row editor opens upward
and remains inside the scroll box. A middle editor opens down. The
middle row stays mounted if opening the editor does not scroll the
box. Text entered in an empty last-row cell wraps over the rows
above it.

[Long Table editor cases](../../../../packages/e2e/src/library-view-long-list.e2e.ts)

Use a trusted click on a visible row and scroll its column into
view before probing editor placement. A long Table may mount a
different set of extra rows while testing. Compare the positions
of the rows that stay mounted and the scroll length. The editor
must fit between the sticky header and scroll box edge. When
tearing it down, allow the first Escape to close suggestions
before the next closes the editor.

[Editor placement probe](../../../../packages/e2e/src/vault-editor-side.ts)
