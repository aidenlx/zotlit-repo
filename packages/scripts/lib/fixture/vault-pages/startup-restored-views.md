---
title: Start-up with restored views
---
# Start-up with restored views

ZotLit finishes loading before it reads the Zotero database, and it reads the database after Obsidian has restored its layout. Each case reloads Obsidian with ZotLit views open, so they restore while the database is still unread.

Run state: the default `configured` Fixture Vault with the `all` Scope Case, built with `pnpm fixture`, with Obsidian open on it. Zotero need not run for these cases.

## Set up the layout

1. Run **ZotLit: Open library view**.
2. Open `query-files/Reading list.zotquery` in a split to the right of the Library View.
3. Open `literatures/ahrensHowTakeSmartNotes2017.md` in a split below the Query File, and select it.
4. Show **References** in the right sidebar and **Cited by** in the left sidebar, each as the selected tab of its group.

Expected: each view shows its content. The layout is saved when Obsidian reloads.

## Restored views show their loading state, then their content

1. Open the developer console (**View → Toggle Developer Tools**) and clear it.
2. Run **Reload app without saving**.
3. Watch each view while Obsidian starts.

Expected, for each view, in this order:

| View | While the database is unread | Then |
| --- | --- | --- |
| Reading list | "Loading…" | "50 results" and the rows of the list |
| Library View | the library tree without Libraries | **My Library** with its Item count, and the papers |
| References | "Open the Zotero database to see references." | Luhmann (1981), "Communicating with Slip Boxes: An Empirical Account" |
| Cited by | a short message, such as "Resolving citations…" | "4 notes · 4 citations" and the citing notes |

The Cited by view never shows "Some citations that use citation keys may be unavailable." The developer console shows no ZotLit warning or error from the start-up.

## A ZotLit link that starts Obsidian

1. Quit Obsidian.
2. Open an `obsidian://zotlit/open` link to an Item that has a literature note in this vault, for example from a Paired Run's Zotero, or paste `obsidian://zotlit/open?item=1&source-id=<id>` into a browser address bar, with `<id>` the `sourceId` that `zoteroPref.current` reports in this vault.

Expected: Obsidian starts, restores its layout, and then opens the literature note of the Item. No notice says that the Zotero database is not ready, even though the link arrives before ZotLit has read the database.
