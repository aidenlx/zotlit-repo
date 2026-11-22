# The Library Tree writes filters

Selecting a node in the Library Tree changes the query of the Library View; the tree never hands rows to the view. A Library becomes the Target Libraries of the request (`libraries` of the Query View request), not a `library ==` filter. A Collection becomes that Library plus the condition `collections.within("<root-first path>")` in the filters for all views, so its subcollections' Items show too. The Reading State facets join the same filters: Annotated `annotations.length > 0`, PDF `attachments.filter(value.fileType == "pdf" && value.exists).length > 0`, Unread `annotations.isEmpty()`. A facet the vault answers, Has note, and the Literature Note half of Unread, is a condition the view applies to the rows after the query ([#1531](https://github.com/aidenlx/zotlit/issues/1531) decides whether the engine takes it over).

Proposed on 2026-10-17 with [#1544](https://github.com/aidenlx/zotlit/issues/1544).

## Considered Options

- **Rows from the tree** (rejected): a second way to list Items next to the query, with its own sort, refresh and expansion.
- **The Library as a `library == "group:N"` filter** (rejected): a filter can only narrow inside the Library Scope in force, so "All libraries" could not widen it, and the engine does not lower it to a candidate set, so every Library in scope is scanned.
- **The Library on the request** (chosen): the Query View reads it from its host with the rest of the request, and a change of Library runs the query again.
- **A Collection by key** (rejected for now): the Filter Expression language names a Collection by its path. The document keeps the path as a list of names, joined with `/` only in the condition.

## Consequences

- "Show all libraries" widens the tree past the Library Scope for the session, except Recent (ADR 0076); it is not part of the Library View Document. A selected Library outside the Library Scope stays in the tree. The toggle shows only when the database holds Libraries outside the Library Scope.
- The Query View gains a host hook for the Target Libraries, part of its run key ([#1545](https://github.com/aidenlx/zotlit/issues/1545)).
- A Collection name that holds `/` cannot be told from a deeper path in `collections.within`, as everywhere in ZotLit Query.
- A renamed or deleted Collection no longer matches the saved path. When the Collections of its Library were read without error and the path is not among them, the tree selects that Library in its place and saves it; a failed read changes nothing ([#1546](https://github.com/aidenlx/zotlit/issues/1546)).
- The paper count of a node is the number of Items its selection lists with no facet and no search: a Collection counts the distinct Items of its subtree, as `collections.within` selects them, so the count in the tree and in the list header agree ([#1546](https://github.com/aidenlx/zotlit/issues/1546)). The counts come from one grouped Items query per Library the tree shows, grouped by `collections[]`: a group value names a Collection by its path only, and the same path can exist in two Libraries. On a 50,000-Item Stress Build the first count after a database change took about 1.7 s in the worker, with no frame gap over 9 ms in the window, and a repeated count 0.15–0.2 s.
- Unread gains `lastRead == null` once ZotLit Query reads `lastRead` ([#1532](https://github.com/aidenlx/zotlit/issues/1532), [#1533](https://github.com/aidenlx/zotlit/issues/1533)).
- "Save as query file" ([#1553](https://github.com/aidenlx/zotlit/issues/1553)) writes the Library as `library == "<selector>"`, first in the filters for all views, since a Query File tab reads the whole Library Scope and has no host to put the Library on its request. A file saved from a Library outside the Library Scope therefore lists nothing until that Library joins the scope.
- The vault conditions run before the row limit (ADR 0071), so Has note and Unread never hide a match that a smaller page would have shown.
- The list header reads "Selection · M unread"; the paper count shows once, beside the node in the tree, and the header leaves it out (amended after the interface review). Like the paper count, the unread count ignores the facets and the search: it is the Items of the node with no Annotation and no Literature Note, counted again on a database, scope, node or Note Index change. Recent has no header text, since the selected node names it. The count the facets narrow is the toolbar's "N of M results", and the search summary while a search is on screen, which screen readers hear as a status.
- The facets stay on during a search and during "Search all libraries", which drops the Collection condition but not the facets (ADR 0073). Facets combine with Recent as with any node.
- The list heading is a title block (amended after the heading redesign): the node's icon in a soft tile, the Collection path above the name as a breadcrumb, the name in the interface face, semibold and one step above the body text rather than a display size, with a smaller icon tile (amended after the typography review: the list heading is chrome a researcher glances at, and the serif is kept for paper titles), and under it the papers shown and the unread count, "3 papers · 1 unread" ("3 of 44 papers" while facets or tags narrow it; "N matches for “…”" as the title during a search, still a status for screen readers). Sort and "Save as query file" sit at the right of the block, and the Query View's own toolbar row is not drawn in the Library View. The active facets and selected tags show under the block as chips that remove themselves, with "Clear all", so the reason the list is narrowed is always on screen.

Use the same chip treatment for facets and Tags, including Tags displayed on the Reading Card. Selected chips use the accent and expose `aria-pressed`. Use an element with `role="button"` for the filter chip because Obsidian's unlayered button rules override the chip utilities.

Store a Collection node's identity as a Library and an array of path names, so persisted node keys can distinguish names containing a slash. Include a closed marker on Library keys because Libraries start open. Prune an unknown node only after reading its Library in full. Sibling Collections with the same path share one tree node. Build the tree from visible parents and omit an orphan whose parent is absent.

Count a paper once in each ancestor Collection even when it is filed in several descendants. Use the same filter for a selected Collection and its count. Compute Reading State facet counts without selected tags or search terms. The Note Index handles conditions that depend on a Literature Note in the vault. Test the derived Filter Expression through the query engine.

## Tree and heading controls

Display Recent before the first database read. Refresh the tree, counts, and Tags when the database changes. A narrow pane opens the tree over the list. A wide pane shows it beside the list and retains the collapsed choice. Toggle a wrapper at each breakpoint because Obsidian controls display on the clickable icon. Keep the Library Scope toggle immediately after the last Library, outside the ARIA tree. Name the tree, active filters, and facet groups with `aria-labelledby` to avoid host tooltips from `aria-label`.

Mount the Query View's Sort control in the Library heading under the Query View's context. At narrow widths, Sort and Save use their icons. Active filter chips remove the individual filter. Text actions and chips use `role="button"` where Obsidian's unlayered button styles would override their utilities. Provide Tab focus and Enter and Space activation for those controls.

### Library navigation proof

Check Library View selection from the active Literature Note
command, the Cited By toolbar, and the native handler for the
Library Link a template writes. An Item absent from all Libraries
leaves the search in place and reports that it could not select
the Item. Check the setup actions above the initial Library View in
the window size used for the course.

[Library navigation cases](../../../../packages/e2e/src/library-view-reading.e2e.ts)

### Tree facet proof

Use a Collection name present in several Libraries to check that
export preserves its Library. Combine Reading State facets with
the selected Collection and with search. Removing the Literature
Note changes an Item without Annotations to unread. An Item read
in Zotero stays read after removal. A narrow pane opens the tree
before a facet press and can dismiss it when focus moves to search.
Verify that plugin reload restores the selected Collection and
facet.

[Tree facet cases](../../../../packages/e2e/src/library-view-navigation.e2e.ts)

Use a tree oracle that counts Items in a Collection and all its
subcollections once. Recent has no tree count. All libraries shows
groups outside the configured scope, and selecting one lists its own
Items. A database change in a subcollection updates ancestor counts
and the selected list.

[Library tree cases](../../../../packages/e2e/src/library-view.e2e.ts)
