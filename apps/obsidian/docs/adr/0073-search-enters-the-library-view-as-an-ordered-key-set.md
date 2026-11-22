# Search enters the Library View as an ordered key set

The search box of the Library View asks the worker search (`SearchItems`, through `ItemLookup`) for the Libraries of the selected node, ranked as the quick switcher ranks. The document keeps the search text; the Indexed Keys the search found, best match first, are an input of the derivation. They become the condition `["K1", "K2", ...].contains(indexedKey)` in the filters for all views, which ZotLit Query lowers to an Indexed Key selection, and the view shows the rows in the rank order of the keys in place of the sort. An empty key set selects no Item.

Proposed on 2026-10-17 with [#1544](https://github.com/aidenlx/zotlit/issues/1544).

## Considered Options

- **A `search(...)` Filter Expression function** (deferred): it would make a search expressible in a Query File, but it needs ranking in the engine.
- **A text filter on titles and creators** (rejected): it does not rank as the quick switcher does, and two search behaviours would differ.
- **Rows from the search, outside the query** (rejected): they would lose the Layout, the expansion and the Reading State line.
- **A key set, re-ranked by the view** (chosen): one search behaviour for the quick switcher and the Library View, and the rows still come from the one query, so the tree node and the facets still narrow them.

## Consequences

- ZotLit Query has no order "by a given key list"; the host puts the rows in rank order after the query.
- The search has the result limit of `SearchItems`; an Item past it does not show, even when it matches the tree node.
- The `tag:` token is a `tags.contains` condition next to the key set ([#1548](https://github.com/aidenlx/zotlit/issues/1548)).
- "Save as query file" leaves the key set out ([#1553](https://github.com/aidenlx/zotlit/issues/1553)): it is a snapshot of one search, and a Query File has no `search(...)` to say it.
- A search of only `tag:` tokens asks `SearchItems` nothing: the tags become `tags.contains("…")` filters and the rows keep the view's sort.
- The search asks for at most 500 hits (`LIBRARY_SEARCH_LIMIT`), under the row limit of 1,000 (ADR 0071), so the limit never cuts a hit before the host puts the rows in rank order. The host reorders through the `rank` hook of the Query View.
- "Search all libraries" searches every Library the Library Scope can reach in this database, the set the quick switcher searches, and drops the Collection condition. It lasts until a tree node is picked or the search is cleared, and is not part of the document. On Recent, which already reads the Library Scope, it is not offered, and the header reads "N matches in Recent".
- The search text is saved after a 500 ms pause and on close. The command and the ribbon put the cursor in the search box; a tab restored at startup does not take it from the editor. Escape clears the box, and on an empty box goes on to the view.
- The Query View's own toolbar search, a text filter of the rows on screen, is a second search behaviour beside this one; the Library View does not offer it: `QueryView.can` has a `search` flag that `displayOnly` turns off (settled in the [#1543](https://github.com/aidenlx/zotlit/issues/1543) review).
- The key set is asked again whenever the database changes, not only when the text or the Libraries change, so a renamed Item joins or leaves the results like any other row.
- While a search is on screen its rank orders the rows, also over a sort on a `vault.` property (ADR 0070), as it does over any other sort.

A search across the Library Scope clears the active Collection restriction. A tag-only search can filter without a ranked key set. Export keeps the tree node's Library restriction as a filter because a Query File tab already supplies its own Library Scope. The save dialog reports the search and vault-only facets that a Query File cannot represent.

## Search controls and results

Publish the newest search result and keep its ranked order. Escape clears the search and restores the tree node's list. During a scoped search the heading path shows where it searches. Mount the screen-reader status before the first count and use it to announce search summaries. The tree announces its own selection. Offer a wider search in the heading when a scoped search finds matches. Put the widening or clear action in the empty list when it finds none, with readable contrast. Recent already searches the full Library Scope.

Debounce saving the search text while the researcher types. Keep the ranked search result when a facet changes, and rerun the search when the selected tree node changes. Update the query's Library context independently of its text. Skip unavailable groups in a saved scope when some Libraries remain. If all are unavailable, keep the saved scope so the query can name the missing Library.

The Library search passes free text to the same ranking as the Quick Switcher
and intersects all recognized tag tokens. Annotation search shares the
tokenizer with color and paper tokens. Recognize names case-insensitively
at the start of the query or after whitespace. Values can be bare or
quoted, and repeated values retain order. Leave an unrecognized name or
empty token in the search words. [Search tokenizer](../../../../packages/plugin-services/src/core/item-lookup/search-text.ts)

Compare row rank with the quick switcher's Indexed Keys. Search
within the selected Collection first and use Search all libraries
to widen it. A tag token keeps the matching Items. Escape clears
the search and restores the Library list.

[Search cases](../../../../packages/e2e/src/library-view-navigation.e2e.ts)
