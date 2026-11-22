# The Tag Selector writes tag filters

The Library Tree ends with a Tag Selector, as Zotero's main window does: the tags of the Items the selected node lists, as a wrapping list of names under the Reading State facets, with a "Filter tags" box at its foot. Selecting a tag narrows the list to the Items with that tag; selecting more narrows to the Items with every selected tag, as in Zotero. Each selected tag becomes `tags.contains("<name>")` in the filters for all views, beside the node's conditions and the facets (ADR 0072). The selected tags are part of the Library View Document, as `tags`, and "Save as query file" writes them with the rest of the filters.

Proposed on 2026-10-18 after the second interface review.

## Considered Options

- **Tags as `tag:` tokens in the search box** (rejected as the only way): the search box already reads them (ADR 0073), but a researcher who knows Zotero looks for the tags under the tree, and a token has to be typed and spelled.
- **Any of the selected tags** (rejected): Zotero narrows by every selected tag, and a researcher who comes from it expects the list to shrink with each click.
- **A Tag Selector in the tree that writes filters** (chosen): one more document field, turned into conditions the engine already runs, so the tree still never holds rows (ADR 0072).

## Consequences

- The Tag Selector lists the tags of the Items the node lists with no facet and no search, as the paper count reads them (ADR 0072). While tags are selected, it lists only the tags of the Items that have every selected tag, so a click never leads to an empty list. A selected tag always shows, highlighted, even where the node holds no Item with it.
- The tags come from one grouped Items query by `tags[].name` per node and selection, in the worker, as the paper counts do. The list shows tag names without counts, sorted by name, and the "Filter tags" box narrows the names it shows. It never changes the list of papers.
- The selected tags stay when the researcher selects another node, as in Zotero. "Deselect all" in the Tag Selector clears them. The list header names the selected tags while any are selected, so a filter is never invisible.
- A `tag:` token in the search box and a selected tag are two ways to write the same condition; neither rewrites the other.
- Zotero's coloured tags and its "Display automatic" switch are left out for now: the Library View reads tag names only.

Group by Tag name and ask for one row per group because the selector needs the group value only. Read the current node without facets or search terms, with all selected Tags as exact filters. Keep selected chips visible while results are pending or when the current answer omits them.

Filter Tag names case-insensitively and always include selected Tags. Use one Tab stop at the last focused visible chip or the first chip. Arrow keys and Home and End move between chips. Bound the list's scroll height so the tree above stays reachable and add padding for focus rings. Escape clears a nonempty Tag filter. An empty filter lets Escape reach the tree's close handler.

A Reading Card Tag chip uses the selector's style and activates that Tag in the Library View while keeping the other selected Tags.

Typing in the Tag name box updates only which chips are shown. It sends no query for the papers. A change to the selected Tags sends the list query.

Use an older saved document that lacks tag selection to check its
default. Each selected tag narrows the Items and available tags.
Several selected tags require all of them and show separate chips.
The tag search narrows tag names alone. Reload preserves the
selection, and deselecting all restores the Library's Items.

[Tag Selector cases](../../../../packages/e2e/src/library-view-navigation.e2e.ts)
