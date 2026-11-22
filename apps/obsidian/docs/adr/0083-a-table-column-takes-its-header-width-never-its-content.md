---
status: accepted
---

# A Table column takes its header's width, never its content's

Every property column of a Query View Table is as wide as its header cell says: the width the researcher set, else a fixed default. The first column defaults to `--bases-table-column-max-width` (300 px), the widest a Bases column grows by itself, where a title reads; every later column defaults to half of that. A body cell takes no room of its own and clips what does not fit with an ellipsis, as a column the researcher sized did before. Cells that span the columns, a group's heading and the rows under an expanded Item, clip too.

A long Table mounts only the rows near the screen (PR [#2023](https://github.com/aidenlx/zotlit/issues/2023)). A column that sized itself to its content took the width of the rows mounted at the moment, so it changed width while the researcher scrolled: one column went from 317 px to 222 px on a 1,000-row Table, and the header cells and resize handles moved under the pointer (issue [#2024](https://github.com/aidenlx/zotlit/issues/2024)). A default that depends on nothing but the column's place is the only rule whose widths do not follow the scroll position or its history, and the browser does the least layout work for it.

## Consequences

- An empty filler column after the last takes the room the columns leave in a wide pane, so the row lines reach the pane's edge. Without it, the browser spreads that room over every column, the gutter included, and no column shows the width it was given. It is `aria-hidden`, and the cells that span the columns span it too.
- One rule for every Table, short ones included. A Table of 100 entries or fewer, which keeps every row, looks the same as a long one.
- Text that fit in an unsized column before can now end in an ellipsis; a wide value no longer widens its column. The researcher drags the column's edge to show more, and the width saves as before (`columnSize`).
- A saved width never holds a default: `columnSize` keeps only the widths the researcher set, and Reset column width removes one. The header's `data-sized` mark still says which widths were set; no style reads it.
- A theme that changes `--bases-table-column-max-width` changes the defaults with it, as it changes Bases' own columns. The defaults read it as a number of pixels without a unit, the form Obsidian sets; a value written with a unit leaves the default columns without a width.
- A vault cell's editor opens at its column's width, so a long value edits in a narrower box than when the column grew to fit it.

## Considered options

- **Accept the moving columns.** No code, but the header moves under the pointer during a scroll.
- **Grow only**: keep the widest width each column reached. The width then depends on the scroll history, `min-w-full` stretching in a wide pane becomes the floor, and it needs resets on pane width and on a change of columns.
- **Hold the widths of the first window, long Tables only.** Later, longer text is cut, it needs a new measurement on pane resize and on a change of columns, and short and long Tables follow different rules.
- **Measure each column's longest value, as Bases does.** Bases measures the header and the value with the most characters across all rows, clamped to 40–300 px. For a Query View that means rendering a measuring row for every column after each result and each change of columns, and the widest-looking value is not always the one with the most characters.

### Table column gesture proof

Keep the drop guide above the sticky header and draw it at the
target edge. Read the current column order on drop because the
file can save an order change mid-drag. During resize, apply
the live width and page-wide cursor without moving the header
or opening its menu. Save on pointer release. A double click or
Reset column width removes the saved value. Width can be
narrower than its content, down to the Bases minimum, and
clipping handles the extra text. The native header menu exposes
the drag operations and disables unavailable actions.

Escape, capture loss, and tab closure cancel without saving.
A drop outside the Table does not reorder. Clear the temporary
guide and cursor when any drag ends.

[Column gesture cases](../../../../packages/e2e/src/query-view-properties.e2e.ts)

Measure the default gutter from the header's expand-button space, so virtualization cannot move it. Reserve an unlabelled filler instead of exposing it as a sortable header. Draw the header over an opaque host surface, including the callout tint, so rows scrolling beneath it stay hidden.

Move a column with a native drag, using a transparent drag image and a drop line above the sticky header. Follow the drag in the source window so it can leave the Table and still clean up. Accept only drops inside the Table with an on-screen order that still matches the live view. Keep move and resize gestures separate. Resize with pointer capture and the Bases minimum width. Show the width while dragging, save it on release, and restore the old width on cancellation. Suppress the click from the release so a mobile resize cannot open the column menu. Start the desktop scrollbar track below the header and enable the browser's styled scrollbar parts so the track cannot take a press from the resize handle.

Show the sort direction on every sorted column, but expose the first sort through `aria-sort`. Use a mask to leave space for the sort mark when the header label is long. When rows follow host rank, leave header sorting unavailable and hide sort marks. Open the column menu on desktop context click or mobile tap.

### Virtual Table geometry proof

Sample header width and position during a rapid scrollbar drag and
a slow drag, including scroll events before rows mount at their new
positions. The widths stay fixed in a spacer-only frame. The
header stays at the top and keeps one set of cells throughout the
drag. Verify that unused width goes to the trailing filler and the
scrollbar occupies its own column beside the header and rows.

[Virtual Table geometry cases](../../../../packages/e2e/src/library-view-long-list.e2e.ts)
