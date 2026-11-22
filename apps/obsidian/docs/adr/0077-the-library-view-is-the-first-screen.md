# The Library View is the first screen

On a first install, ZotLit opens the Library View, not the Welcome View. It opens once, through the release flow that opened the Welcome View, and the researcher sees their papers before any setup. Browsing, search and opening a PDF need only the Zotero database, so the Library View asks for nothing more. When ZotLit cannot find the Zotero data directory, the list says so and offers "Locate data folder" and "Open settings", the tree shows a one-line warning, and the papers appear as soon as the folder is set. The Welcome View keeps its logic but renders as a dismissable banner above the Library View while setup is incomplete, laid out for a banner rather than a tab (amended after the banner redesign): the header with its badge and tagline; the steps "Connect to Zotero", the literature-notes folder and "Open your library" as a checklist in which a done step takes one line and only the next step opens with its text and action (amended after the banner review: a step that isn't done shows its number in its mark, and the next one is an accent-tinted row with its action at the end of the title line and its text underneath; each callout takes the same shape); and beside it the Help Links; its "Create your first literature note" step is gone, since the list under the banner is the library (amended after the second interface review). ZotLit Companion, Better BibTeX and the local server are named only at the action that needs them.

Proposed on 2026-10-17 with [#1554](https://github.com/aidenlx/zotlit/issues/1554).

## Considered Options

- **Keep the Welcome View as the first screen** (rejected): it opens on setup steps, and the researcher sees requirements before they see their library.
- **Remove the Welcome View** (rejected): the upgraded state's Migration Prompt and the connection readout still have to reach v1 upgraders.
- **The Library View first, with the Welcome View as a banner** (chosen): the first thing on screen is the library, and setup appears beside it, not in front of it.

## Consequences

- An upgrade from v1 still shows the Migration Prompt, now in the banner, until it is acknowledged.
- The ribbon icon and the command that opens the Library View ([#1545](https://github.com/aidenlx/zotlit/issues/1545)) reach it at any time.
- The getting-started docs start from the Library View ([#1555](https://github.com/aidenlx/zotlit/issues/1555)).
- Dismissing the banner saves `welcome.dismissed` in plugin data and acknowledges a pending Migration Prompt; the "Open welcome view" command shows the banner again. Setup counts as complete when ZotLit reads the Zotero database and the literature-notes folder exists.
- When the data folder is missing, the not-found state replaces the tree, the facets, the search box and the list; the search asks the database nothing until the folder is found. The "Zotero wasn't found" notice and "Set up connection" open the Library View.
- The Welcome View has no tab, and the `zotlit-welcome` view type is no longer registered (amended after the standards review, replacing a view type kept only to turn a tab restored from an old workspace into the Library View): such a tab shows as Obsidian's view of a plugin that is not loaded, and the researcher closes it.
- The Companion step is gone from the banner; the release notice for Companion still reaches users who update.
- One visibility module decides what the banner shows, as sections: the setup steps while setup is incomplete, the Migration Prompt while it is pending, and the template conversion offer and its result while they are pending. The banner renders exactly those sections; while a migration is pending, the Companion guidance for Zotero 10 shows with it; "Open welcome view" and the settings button "Review conversion" show the banner even when setup is complete: they set a session request for it, which dismissing clears (amended after the [#1543](https://github.com/aidenlx/zotlit/issues/1543) review).
- "Zotero not found" means the database the settings name does not read: the data folder is missing or unreadable at start, or was changed to one that does not read, even while the earlier database still serves. A failed refresh of the database the settings name, while it still reads, keeps the last rows and shows a short note, as the spec asks (amended after the [#1543](https://github.com/aidenlx/zotlit/issues/1543) review).
- At most one "Zotero wasn't found on this device" notice exists. It hides once Zotero reads again or a Library View opens, and none shows while a Library View is open, since the view's not-found card says the same.
- The banner keeps the documentation and community links in view, as the Welcome View tab did: they are how a new researcher finds the docs, the discussions and the changelog, so they are not folded into a menu (amended after the second interface review, which reversed a Help menu). They are the Help Links: tiles for Getting started (the large one), Chat & discuss, GitHub (which asks for a star: "Star on GitHub", "Like ZotLit? Leave a star"), Templates and Citations, then Blog, Changelog, Sponsor and, in the fresh state, the migration guide as text links. They show whenever the banner shows, in every mode and section: the setup checklist, the Migration Prompt, the template conversion, or a banner the "Open welcome view" command asked for; the vertical timeline of the Welcome View tab does not fit a banner and is gone (amended after the banner redesign). While the Library View shows its not-found card, the banner leaves out its Connect step, which would say the same, and the "Search your library" action, since the search box is gone. Otherwise that action puts the cursor in the Library View's own search box, under the banner (amended after the third interface review).
- An update of ZotLit shows in the banner, in place of the update notice (amended after the banner redesign). When the recorded version is older than the running one, and release notices are on, the launch check reuses an open Library View or opens one as the first screen does, in the active leaf only while it is empty and otherwise in a new tab, so neither a first install nor an update replaces the note the researcher has open, and the banner shows an update section: "ZotLit updated to <version>" with a "What's new" button that opens the Release Note, beside the Help Links. A fresh install and a downgrade show no update section. Dismissing the banner or opening "What's new" records that version as seen, in plugin data, so the section shows again only after the next update; other sections keep their own rules. The badge names the strongest notice the banner shows: "Welcome back" for an upgrade from v1, else "Updated" while the update section shows, also beside a template conversion, else "Let's get started" (amended after the banner layout review). Mobile behaves the same; the Release Note opens in the browser where no Web Viewer leaf exists.
- The banner is laid out like an article, the same in every case (amended after the banner layout review). The banner's background spans the tab as a bar; on a wide pane it holds two areas inside the banner's inline margins (amended after the banner alignment review, replacing one column at most 64rem wide from the Library Tree's left edge): the Help Links in a column of fixed width at the end of the pane, and the rest of the width for what to do, whose header and sections sit centered there in a column at most 40rem wide, so the eye lands on the steps rather than on the links, and a wide pane adds space around the steps rather than stretching them. Its dismiss button stays at the banner's top-right corner whatever the width, where a dismissable bar's close button sits, rather than following the content (amended after the footage review). In that column, what to do comes first — the update, the Migration Prompt, the template conversion, the Companion guidance, then the setup steps — and the Help Links sit in their 22rem column at the end, two tiles to a row; under 760px the column stacks, with the Help Links last and the small tiles keeping their icon and title only. When every step is done and the banner also shows a notice, the checklist folds into one "Setup done" line with a "Show steps" control; the checklist the "Open welcome view" command asks for stays open. A notice shows one lead sentence and its action, and puts any longer explanation behind "How it works", so the banner fits without scrolling. The header names ZotLit with its brand lockup, the two-ink mark and the wordmark of docs/brand.md in the theme's inks, rather than the name in the interface font. Within the centered column everything shares one start edge: the lockup, the step marks and the notices' text, with the tinted surface of the open step and of a callout hanging outside it; the header line holds the centered header and, at the end, the dismiss button, and under it the first section and the Help Links start on one top line, and the banner keeps the same inline margin to the pane's start and end edges (amended after the banner alignment review).
- The researcher can dismiss the banner in every case, and it stays away until a new event brings it back: a later update of ZotLit, or a new Migration Prompt (amended after the banner layout review). The "Open welcome view" command shows it again with its setup steps and moves focus to it. The Library View's "Welcome & help" view action in the tab header toggles it: while the banner is hidden it shows it as the command does, and while it shows it dismisses it as the dismiss button does; the action reads as pressed while the banner shows (amended after the footage review, which moved it from the foot of the Library Tree).
- Whether the banner shows is one saved state, not a session request (amended after the persistence review). The dismiss button, "Welcome & help", the "Open welcome view" command, the settings button "Review conversion", setup completing and an update all write it in plugin data, so the banner a researcher sees before a reload is the one they see after it, and the pressed state of "Welcome & help" follows it. "Show steps" on the folded "Setup done" line is saved the same way, until the banner is dismissed.

Show at most one missing-data-folder notice. Remove it when the database reads again or a Library View opens, because that view supplies its own card and folder action. Persist an explicit Welcome request until dismissal. When a new version is pending, keep the update banner visible until the researcher opens What's new or dismisses it.

## Banner state and lifecycle

Offer ZotLit Companion and ZotLit Reader as optional steps after the core setup, with the first unfinished step open. The required steps are the connection and the literature-notes folder. Wait until connection status is known before opening an incomplete checklist. Keep a pending conversion offer visible. A conversion result remains visible during setup, after a conversion in the current banner, or while cleanup is pending. Reuse the same refusal message in the transient notice and banner so it remains available for retry. Keep the conversion scoped to its leaf. Closing the banner interrupts that leaf's command immediately, while its protected writes finish. Flush saved banner gestures so an immediate reload preserves them.

Share the connection count and its refresh across the Library leaves. Use a cached count before first paint, invalidate it before publishing a reader revision, and hold an earlier answer briefly while a refresh runs. If the refresh still has no cached result after 200 ms, show the checking state. Interruption cancels the cached read when its shared owner goes away. Check Zotero's add-on list again when the researcher returns to Obsidian or the profile or database changes. Retry briefly because Zotero can write the list after Obsidian starts. A new trigger replaces the previous retry.

## Launch decisions

Treat a strict semantic version increase as an update. Preserve a pending update on a same-version relaunch until acknowledgment. A downgrade or unknown prior version clears the pending update. A new version with notices disabled also clears it. Crossing the Zotero 10 Companion release threshold shows the Companion notice in place of the banner update. The Release Note opens from a user action, in Obsidian's Web Viewer when enabled or the system browser otherwise. Resolve localized documentation URLs when the link is used.

Detect an upgrade from Legacy Data or from ejected `zt-*.eta.md` templates in v1's default folder when settings are absent. Restore that folder for a templates-only upgrade. During later launches, clear a pending Migration Prompt when its configured folder no longer holds ejected v1 templates. A pending flag alone does not open a new tab. Run the launch check after settings and the workspace are ready. Gate the one-shot layout callback on disposal because the host provides no unregister operation for it.

## Banner presentation

Use text and an icon to identify step status. Use the accent as a border where text on an accent fill would miss the contrast target. Keep the dismiss button at the end of the header, following the title in focus order. Give the banner its name with `aria-labelledby` so Obsidian does not attach an extra tooltip. Move focus to the banner after an explicit request. Use a flex checklist row with its own number because Obsidian's unlayered list rules draw a second marker on list items. Set the Help Link color inline so Obsidian's unlayered link rules do not replace it. Keep each step title visible and truncate its summary first.

Build the lockup from the canonical two-ink mark and the glyph group of the wordmark. Align the 16-unit mark to whole pixels. Scale the Archivo SemiBold outlines to a 12px cap height on a baseline at y=14, with a 4px gap before the Z. The SVG starts at the mark's ink edge. Use the theme's brand inks.

Include the migration reminder in the Settings group only while it is pending. A hidden first row stays in the host's DOM and takes the first-child position, causing a stray divider above the next visible row. The settings focus follow-up is tracked in [issue 147](https://github.com/aidenlx/zotlit-repo/issues/147).

On a failed refresh with a readable database, keep the existing rows and show a short refresh notice. Give the missing-data-folder card its name from the visible title, which avoids the host tooltip generated for `aria-label`.

An explicit Library View open activates an existing tab and can focus its search. A restored tab does not take focus. Wait for the Welcome connection read before deciding whether to focus the search on arrival. Keep the current focus if the banner is present or the researcher already moved focus. The Welcome action can focus search explicitly. A missing-file state survives initial database load so a later view registration still offers the folder action. Retry the stored search when the database becomes readable.

### Welcome View proof

Use a vault with no plugin data to check the first launch. The
release check opens Library View once and records it. With setup
incomplete, the banner lists the open step and Help Links without
requiring the Companion. Search your library focuses the search
field, while the banner's initial render leaves it unfocused.
The Welcome command and the tab's Welcome & help action reopen the
banner. The tab action moves focus to it and toggles it closed.
Clear a notice that would obscure its dismiss control.

If Zotero's database is unavailable, offer Locate data folder in
place of rows. On a narrow pane, the list supplies the action
while the tree is hidden. Set the dialog's chosen path through
the same setting during the case and verify the rows return.

For an update, keep the active note and open Library View in a
separate tab. Show the update in the banner and acknowledge it
through What's new. Acknowledgment or dismissal survives reload.
With template conversion as well, keep the Updated badge, fold
completed steps, and defer the longer explanation to How it works.
Arm the offer after plugin load because detecting converted
templates can clear the saved offer.

In the layout proof, wait for the connection readout and expected
sections. Use equal edge margins and a shared left alignment for
the lockup, steps, and status text. Keep tinted surfaces clear of
Help Links and the dismiss action clear of all tiles. Stack the
column in a narrow pane and place it beside the Help Links in a
wide pane.

[Welcome View cases](../../../../packages/e2e/src/library-view-navigation.e2e.ts)
