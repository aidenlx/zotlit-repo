# Lessons prerender complete and load recordings on demand

## Context

A Learn page must work beside Obsidian, present complete instructions without JavaScript, and avoid starting every clip when it becomes interactive. The editable checklist and the Markdown edition also need the same step order and names.

## Lesson content and navigation

Author a numbered `<Step n={1}>` with the action, a `<Check>`, an optional `<Figure>`, and any `<Fix title="…">` sections. Pair each step with its frontmatter title and picture text. Bind those same step components to frontmatter for Markdown. A check or fix reads as a single short block even when MDX splits the source at a label on its own line. In Markdown, fold the text back into one paragraph, treat a formatter's `{" "}` as a space, and strip internal bold markers before wrapping the lead-in. Give the check band a spoken label, and give each step a spoken position such as “Step 2 of 6” in place of its visual number. The running fix button names the disclosure. The always-open no-script fix panel uses its own heading.

Prerender the outcome above a complete checklist and keep all its instructions and stills accessible without scripts. An inline marker lets CSS show only the hash target before hydration when JavaScript will run. A layout effect sets the same marker for client navigations before paint. Once the page is ready, a numeric hash opens that step, and `#done` names the end. With no step hash, resume the first unticked step for a reader with progress. A new reader sees the outcome with every row closed. Ignore a hash the view wrote itself. Defer scroll and focus movement until the new row has rendered. The end is represented by one position past the last step.

Load saved progress after mount and keep a lesson marked done once every step has been ticked. If storage denies access, allow the checklist to continue in memory. Hash navigation reads the ticks from memory, as the 2026-11-23 amendment states. [Resume position](https://github.com/aidenlx/zotlit-repo/issues/107)

Start opens the first unticked step and requests immediate playback. A row's tick action and the ended clip's tick action share the same behavior. Once checked, advance to the next unticked step, wrapping if necessary, and bring the end into view if no steps remain. Offer two further lessons, prioritizing unfinished Lesson 1, then the remaining unfinished lessons in course order from the current position.

Use the shared lesson type scale for action, check, fix, and figure content. Keep label and inline code roles distinct from body text. Let an inline command match its sentence and give a block command the title and label roles. Keep secondary action styles separate from the MDX module so the player can use them without loading the lesson authoring components.

## Images and playback

Choose a generated poster when present and otherwise use the step screenshot. Give the first outcome still eager loading and high priority. Load following stills lazily. Use the clip's dimensions when they differ from its still, so changing from one to the other keeps the frame stable. Only the active step mounts its lazy player. Cards use a cropped still. At the `xl` breakpoint the running lesson puts the media in a side panel. A change from the outcome to the last step mounts a fresh player even though they share the same source, because the outcome loops and the step plays once.

Use one Video.js control set for silent recordings, with play, seek, time, and fullscreen. The lazy player can read reduced-motion preference after hydration. Reduced motion leaves the poster at rest and limits preload to metadata. Deployed clips use the media-store URL and local clips use the site path. Automatic playback uses the middle 20 percent of the viewport. Reader-initiated playback can continue across the rest of the viewport, and a Start request can retry when the picture first enters it. Move focus to the player when its control bar or Replay button disappears. On a narrow card the replay icon keeps a 44 px button and an accessible name. When the one-shot recording ends, show the page's action with the single centered Replay control.

All recordings and the landing table demo share one playback turn, which one coordinator owns. Each player hands it a loop that can rest and, when the coordinator may resume it, start; a start reports whether playback began. A new start rests the old holder, and the coordinator queues the rested loop when it can start again. A player stays queued or holds the turn only while it is eligible, and each loss of eligibility ends its turn. The table demo is eligible while at least half of it is on screen, motion is allowed, and the reader has not paused it. A manually paused recording holds the turn until it leaves the viewport, while another deliberate play can take the turn immediately. A one-shot end or unmount releases the turn. Remove requests that are no longer in view. Resume the first eligible waiter when the holder ends.

Count pending programmatic plays and pauses separately so their later browser events do not look like reader actions. A pause from reaching the natural end leads into the ended handler and does not claim a manual hold. On a refused play, correct the pending event count when no play event will arrive, and report the start as refused. A refused start ends that player's turn, so the first waiter starts, and the refused loop leaves the queue until its player asks again. [Playback turn follow-up](https://github.com/aidenlx/zotlit-repo/issues/108)

See [Learn and recording design](../../DESIGN.md) and the implementations in `apps/docs/src/components/learn/`, `recording-player.tsx`, and `recording-turn.ts`.

### Lesson walk proof and framing

Each walk executes its lesson's steps in order and observes the
running apps. Seed earlier outcomes explicitly because each walk
opens its own Fixture. Later lessons use the note from the first
lesson and close the Library tab's setup section. The Word walk
also seeds the draft edits and page citation from the previous
lesson.

In the literature review table, check visible title and rating
text by its rendered bounds, excluding padding and icons. Ignore
empty text rectangles and the unnamed expander header. Search
for Creators before adding the Column. Close both sidebars so the
new Columns fit. A rating writes a Vault Property and can create
a Literature Note. The corresponding Zotero Item stays unchanged.
Read the pasted Markdown table without Obsidian's cell padding.

For reading status, preserve the horizontal scroll chosen in the
preceding step. Editor focus alone can shift it a few pixels. Keep
the Title and status Column legible together. Offer a Vault
Property separately from a Zotero field. An existing Literature
Note has an empty cell, and an absent note shows its missing-note
state. Creating the note from the cell keeps the plan active.
Frame the suggestion menu while it is visible and park the
pointer away from its text.

Read the Word export with Pandoc. Check the default file-explorer
setting that can hide the Word file while it is present in the
vault. Show its first page through macOS Quick Look for the
lesson still. Use the export notice as the clip's last view and
park the pointer clear of it.

[Review table walk](../../../../packages/e2e/src/docs-walks/build-a-literature-review-table.walk.ts) ·
[Reading status walk](../../../../packages/e2e/src/docs-walks/track-reading-status.walk.ts) ·
[Word export walk](../../../../packages/e2e/src/docs-walks/export-to-word-with-a-bibliography.walk.ts)

### Install and annotation walk state

Use the reader's default Zotero path and the PDF filename in
lesson images. The actual data comes from the test Fixture.
Remove Companion only from the Paired Zotero profile before
the lesson installs it. After recording the real community
install, restore the dev builds. The remaining steps need
their dev CLI. Reset saved settings to reproduce first launch.
Wait for the Companion check and keep the setup section open
until installation. Non-recording runs install the Fixture
Companion locally. Verify that dismissing setup survives
reload and that Welcome & help toggles it again.

Open the PDF on page one. Obsidian's PDF history is shared
across vaults, so remove only this PDF's fingerprint entry.
Load pdf.js the same way as Obsidian to find that fingerprint.
Check Marks using their Zotero colors and keep the PDF open
beside the newly written Literature Note.

The next lesson starts from that note and without editing
authorization. After the write, verify the highlight in
Zotero and check that the new card appears in the Literature
Note without a file update. Opening the note can hide the
Mark Popup while its PDF tab remains open. Verify that the
walk did not hand a PDF open to the system's Zotero handler.

[Connection walk](../../../../packages/e2e/src/docs-walks/connect-zotero-to-obsidian.walk.ts) ·
[Annotation walk](../../../../packages/e2e/src/docs-walks/annotate-pdfs-in-obsidian.walk.ts)

## Amendment (2026-11-23): hash navigation reads the ticks from memory

The hash effect of the lesson view picks the row from the ticks in memory, through a ref that the lesson load and each tick set. Blocked storage therefore keeps the resume target. A lesson switch resets the guard that skips a hash the view wrote, so the first row of the new lesson opens.

Accepted limit: the effect wiring has no automated test, because the docs tests are pure-logic unit tests with no component render tests. A browser check on `vite preview` with storage that throws covered it: a tick on step 1 opened step 2, `#1` opened step 1, and the bare URL opened step 2 again with step 1 still ticked.

[Issue 107](https://github.com/aidenlx/zotlit-repo/issues/107) · [PR 247](https://github.com/aidenlx/zotlit-repo/pull/247) (`ec6b29c8f`)
