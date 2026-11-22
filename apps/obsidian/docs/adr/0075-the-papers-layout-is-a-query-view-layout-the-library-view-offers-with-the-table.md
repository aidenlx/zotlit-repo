# The Papers Layout is a Query View Layout the Library View offers with the Table

The Papers Layout is a fifth Layout of the Query View for the Items dataset, next to Annotations, Table, List and Cards: each Item row has two lines (the title, cut to one line; creators, year and publication), and it expands into Attachments, child notes and Annotations through the expansion the Table uses. A Query File can name it like any Layout, so "Save as query file" reproduces the rows the Library View shows. The Library View offers only Papers; a host names the Layouts it offers, and the view menu lists only those (amended after the second interface review: the Table left the Library View, which is no place for the full Query View).

Proposed on 2026-10-17 with [#1547](https://github.com/aidenlx/zotlit/issues/1547).

## Considered Options

- **Rows drawn by the Library View itself** (rejected): a second Item list beside the Query View, with its own expansion, selection and refresh, and a saved Query File could not show it.
- **Restyle the List Layout** (rejected): List is a Layout of every dataset, and a Query File that uses it today would change.
- **A new Layout, offered per host** (chosen): one way to draw Items, available to every Query File, and the Library View stays as small as its jobs.

## Consequences

- The Query View host contract gains the list of Layouts it offers; a host that names none offers every Layout of the dataset, as today. Under `displayOnly` (ADR 0071) a host that offers one Layout shows no view menu at all. A host that gives `saveAs` shows "Save as query file" as a toolbar button ([#1553](https://github.com/aidenlx/zotlit/issues/1553)); the saved file uses the Papers Layout, so it opens on the rows the Library View showed, with the Table and every other control one click away.
- A row has no reading-state line (amended after the second interface review): three lines per paper with an Annotation count read as noise in a list meant for finding a paper. The row reads only the title, creators, date, Venue and Attachment kinds, not the Annotation colours. The reason the host gives the row, when it gives one (ADR 0076), ends the second line. The Literature Note shows as the note icon at the end of the row; the Annotated facet and the Reading Card carry the rest of the Reading State.
- In the Table and Papers Layouts, a child note row links to the note in Zotero through `zotero://select`, the link Show in Zotero opens (ADR 0074).
- A Papers row starts with the icon of its Item type, as Zotero's item list does: a book, a journal article, a thesis, a letter, a web page and the rest each show a Lucide icon from one map, with a document icon for a type the map does not name. The icon is decoration; the type is not read out, since the title names the row. Each Library Tree node shows an icon too: a clock for Recent, a library for a Library, a folder for a Collection (amended after the second interface review).

Use creators with the first creator's role to match Zotero's Creator column. Use family names or literal names, with up to three followed by the localized equivalent of “et al.”. Reserve the first line even when the Item has no title. A row without metadata uses only that line. Align the chevron, type icon, and marks with it, and reserve two fixed slots for the Literature Note and Attachment marks. Prefer PDF, then EPUB, then web for the Attachment mark. Project the Reading Card's header fields so it can show them before the Item read finishes. During Child row loading, reserve the height of the replacement row to limit layout movement.

Choose a Lucide icon included in Obsidian for each top-level Zotero Item type.
Reserve the PDF icon for a PDF attachment indicator, so articles use their
periodical icon. Use a document icon for unknown types. Keep Show in Library
behind a capability provided by the Library View so other surfaces can
request it without the App. The command can finish opening the Library View
after its originating pane closes. Select the Item in its first Collection
and explain when it could not be listed or found. [Item icons](../../../../packages/obsidian-kit/src/item-type-icon.ts) · [Show in Library](../../../../packages/obsidian-kit/src/show-in-library.ts)

### Long list proof

Build a Stress Build isolated from the shared Fixture and Development
Vault. A long list needs enough Items for a scrollbar drag to cross
several screens in one frame. Wait for height, mounted rows, and
columns to settle, then sample at each simulated drag frame. Count
entry height and mounted rows. The bound includes the viewport with
partial rows, overscan on both sides, and the selected, first, and
focused rows held outside the window. Ignore a scroll offset the
browser clamps at the end.

Show in Library must fully reveal and focus a far row. The row stays
mounted when the list returns to the top, and Down selects and reveals
its successor. A drag must keep the thumb under the pointer even as
entries mount. Sample the reverse drag and check that a painted
frame has rows or row outlines. The outlines come from the box, so
spacers reserve height only and painted rows cover the outlines.
Check alignment to row edges under larger theme sizing.

Use wrapping titles, indented properties, and grouped rows to check
different heights. Narrowing the pane changes the wrap and height.
Test font measurement error by increasing letter spacing after the
canvas estimate. Apply measured heights after scrolling settles and
keep the current rows in place.

[Long list cases](../../../../packages/e2e/src/library-view-long-list.e2e.ts)

### Papers interaction proof

A paper uses up to two lines and includes the first creator, year,
and Venue on the second. Show a Literature Note as an icon and again
in the expanded rows. Expand Attachments, live Child Notes, and the
Literature Note. The Literature Note can appear immediately, while
Attachment and Annotation rows need the query. A note-only row
requires no worker read. With a delayed worker read, show loading in
the room the child rows take. In each frame, following rows move once
to their final position without overlapping or remounting. Check
this in the tab, sidebar, and Query File.

Keep the search field and heading in place while the list scrolls.
Reserve scrollbar width beside the row icons under both overlay
and layout scrollbars. Arrow keys from outside the viewport reveal
the newly selected row fully below the heading. Activate the Library
View again after gestures that open other tabs.

### Trusted scrollbar drag

Send the drag from Electron's main process to exercise Chromium's
thumb behavior. Keep the scroll length constant during motion so
Chromium does not retain an offset between the pointer and thumb.
Use fast and slow legs, holds, and a reverse. The short moves near a
hold model the pointer slowing down. Align the main-process times to
the page's time origin. For an overlay scrollbar, scroll first so
the bar shows. Measure the thumb in a plain box with the same size,
scroll length, classes, and ancestors, then compare against the
pointer position in each hold.

Record compositor frames as well as mounted rows and page geometry.
A drag can move farther than the page paints, so mounted rows alone
cannot prove the box was visible. Sample the row area below the
header and beside the bar. Distinguish text from faint outlines and
horizontal row rules when checking pixels.

[Papers cases](../../../../packages/e2e/src/library-view.e2e.ts) ·
[Trusted scrollbar drag](../../../../packages/e2e/src/scroll-drag.ts)
