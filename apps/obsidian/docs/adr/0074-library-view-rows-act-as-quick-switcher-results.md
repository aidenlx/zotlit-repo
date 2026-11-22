# Library View rows act as quick switcher results

A row of the Library View answers the same keys as a quick switcher result, so one habit opens a paper from either: Enter opens the Literature Note, or writes it through the same Profile selection when there is none; Shift+Enter opens the PDF in Obsidian; Mod+Enter opens the Literature Note in a new pane. Double click opens the PDF, since a researcher coming from Zotero double-clicks to read. Space on the selected row turns the item details on or off (ADR 0071, amended after the details review); a quick switcher result has no card, so Space there stays text. Insert citation, Copy citation key, Open PDF to the right and Show in Zotero live in the row menu, built through the existing menu-event seam, and run the operations every other surface runs: Show in Zotero opens the same `zotero://select` link as the citation popover and the References view. Dragging a row into a note inserts a citation; it is the first Item drag, with its own payload type next to the Annotation drag, and the editor drop reads both.

Proposed on 2026-10-17 with [#1549](https://github.com/aidenlx/zotlit/issues/1549).

## Considered Options

- **Enter opens the PDF, Shift+Enter the note, Mod+Enter cites** (rejected): the spec's first list. It put reading first, but the quick switcher binds Enter to the note, and two surfaces that open the same paper with different keys teach two habits.
- **Rebind the quick switcher to Enter = PDF as well** (rejected): it changes a habit researchers already have, for a surface they have not used yet.
- **The quick switcher's keys** (chosen): Cite moves to the row menu, where Zotero users look for it.
- **A Library-only "Show in Zotero" that checks Zotero first** (rejected): a second behaviour for one action. When Zotero is closed, the operating system starts it from the link. Opening a `zotero://` link gives no failure signal, so nothing warns when no handler is installed.

## Consequences

- Each key acts on the selected row; arrow keys move the selection, and single click only selects.
- The quick switcher gains "Show in Library", which opens the Library View on the Item's first Collection.
- The row menu is the one place that lists every action; the Reading Card ([#1552](https://github.com/aidenlx/zotlit/issues/1552)) reuses its operations.
- The quick switcher's "Show in Library" is Alt+Enter (⌥↵). It opens the Item's first Collection, or its Library when the Item is in none, clears the search, and selects the row; the item details show it while they are on, and stay off while the researcher keeps them off (amended after the details review).
- One module opens notes and PDFs for both the quick switcher and the rows, so the two keep the same keys and Profile selection.
- The row menu raises `zotlit:item-menu` (`{source: "library-view", indexedKey}`, sections `open`, `insert`, `clipboard`, `zotero`) after its own entries, so other plugins can add theirs.
- An Item drag outside a note carries the `zotero://select` link as text. Insert citation goes to the note that was active last, because Obsidian names no active editor while the Library View tab is active. "Active last" covers notes already open when the plugin loaded, read through public workspace API (amended after review pass 4).
- The selection is session state, not part of the Library View Document. Arrow keys and the row keys do not act inside text fields, links, buttons, menus, list boxes or the tree.
- "Show in Library" also turns the facets off, so a facet never hides the row it reveals.

## Action targets

Use the active insertion editor when available. Otherwise find the most recently active note that still has an open editor in Source mode or Live Preview. Consult the workspace's file history and current open views because a tab can become active before it loads a file. A drag uses a request token for its Item payload and inserts at the nearest editor coordinate. Exact coordinate lookup can fail over an empty line. A drop back on the Library View advertises no drop action.

Resolve PDF Attachments through the database because the search index contains regular Items only. A key gesture supplies no pointer anchor, so a choice of PDFs opens the Suggest modal. In the Reading Card, PDF is the primary action for an Item with a PDF. For other Items the Literature Note is primary. Offer the Annotation View through its own icon.

Register each exact modifier chord in the quick switcher because Obsidian's unmodified Enter binding does not receive those chords. Use the platform hotkey glyphs. The command and file menu can show a Literature Note's Item in the Library View. The template's `zt.librarylink` protocol URL carries the Indexed Key without a device source ID so the link can work from a synced note on another device.

Mount Item actions for the plugin lifetime so a gesture can finish after its Library tab closes. A menu selects the row it acts on and uses its own key scope. An open tree's scope handles Escape before the list, with a nonempty Tag filter clearing first. Keep Escape in the view to prevent the host from switching to its last navigable tab.

Hold an interruptible Collection lookup while a leaf waits to reveal an Item. A missing Item or Library leaves the current list intact. After revealing a listed Item, wait for its row to mount and focus it through the layout. Restart its highlight animation with a style read between removal and restoration of the attribute. Report a row beyond the limit as unlisted without selecting it.

Give the row list one Tab stop at the selected row, or the first row before selection. The focused row is a group named by its title. Leave an Escape key used to cancel input composition with the input method. Leave Space with a nested control or, when no row is selected, with scrolling.

An Items Layout exposes the complete ordered key list to its host so keyboard selection works across virtualized rows. The layout scrolls to the key as measured rows change. Give the active row `aria-current` because a row can contain interactive children. A click on an embedded control still selects its row while the control handles the action.

When an Items Layout virtualizes, pin the selected, first, and focused rows for keyboard use. For a short list that mounts every row, scroll the element itself. Clear the row order when the Layout unmounts. Name focusable Papers rows with their title element through `aria-labelledby` so the row does not gain an Obsidian tooltip from its accessible name.

### Literature Note action proof

Check a linked PDF in Zotero storage outside the vault and an
unlinked PDF inside the vault. After resolution the latter has no
Literature Note control. On the associated PDF, run the header
action, command, and More options entry with the PDF active. Each
reveals the same existing note tab without opening another. After
deletion the action offers to write the note again.

[PDF header cases](../../../../packages/e2e/src/library-view-reading.e2e.ts)

### Row gesture proof

Wait for the animation frame after a row scrolls into view because
content visibility defers its children and hit testing can initially
return the list item. Selection markup can also take another frame.
Press near the start of a row where a narrow Reading Card leaves it
reachable. A click selects without opening and Down follows the
on-screen order. Enter opens or creates the Literature Note.
Shift+Enter opens the PDF after the note open settles.

Wait for Profile previews before choosing, and verify cleanup by
both Note Index and frontmatter when a case writes a note. The row
menu includes plugin additions and offers PDF open only when the
Item has one. Insert citation uses the last active note and its
cursor. A row drag into the note inserts the citation at the drop
point, and a drop on Library View is refused. Show in Library in
the quick switcher reveals the Item's Collection and selects its
row.

[Row gesture cases](../../../../packages/e2e/src/library-view-navigation.e2e.ts)
