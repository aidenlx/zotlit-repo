# The Note preview keeps its settings in native chrome

> Amended 2026-11-06 by [ADR 0081](0081-fields-and-preview-are-side-panels-of-the-template-workbench-view.md): the Note Preview is now the Preview panel of the Template Workbench View, and its settings sit in that view's pane menu while the panel shows. Show Markdown and the updated-section choice are pane-menu entries only: the view header already holds the editor's own actions, Advanced's `code` icon among them, and two more header toggles for one panel would crowd it. The sections below describe the original decision.

The Note preview pane in Obsidian stacked two rows of labelled selects above
the rendered note: Preview mode (Create, Update) and Refresh preview (Live, On
demand) on one row, then an h2 "Note preview" beside Show (Complete note,
Updated section only) and Preview format (Reading view, Markdown). In the
linked full pane at 366 px, the note body started about 280 px below the
pane top, under a 38 px native header, 68 px of controls, a 95 px result
header, and a bordered card with its own 12 px inset. Three of the four
settings change rarely, the heading repeated the native title's "Preview"
role, and "Live preview paused" stayed on screen for as long as On demand
was selected, describing a setting as if it were an event.

Decided in the Note preview grilling on this branch (2026-09-10): the pane
keeps its settings in Obsidian's own chrome. The pane menu has three
sections: the selection actions; one checked choice of note that starts with
the verb Preview — Preview as new note, Preview as updated note, Preview
updated section only; and the display checkboxes Automatically refresh
preview and Show Markdown. Show Markdown and the updated-section choice are
also view actions that swap icon and label like Obsidian's reading-view
toggle. The content starts with one 12 px pane heading, which still names
Note preview, Final properties, or Annotation example as the editor's tab
changes, beside a muted caption that names the chosen note and, in on-demand
mode, "On demand". The rendered note sits on the pane surface with no card.

The note choice is one question, "which note am I looking at", over the two
stored flags. Create and Update pick the base note; the managed region is the
same text under both, and Update equals Create whenever the Item has no note
in the vault. The menu maps the triple onto `mode` and `showManaged` in one
store write, so persisted layouts and the web Workbench need no migration,
and Preview as updated note is disabled while the last result reports no
existing note.

On-demand feedback follows the render scheduler's stale reason instead of
the refresh setting. The shared scheduler publishes `staleReason` — hold,
demand, live, or null — and refreshes it when a queued render is dropped on
switching to On demand. The Obsidian pane shows an inline notice with Run only
while the result is behind the edits ("Preview is behind your edits.") or
nothing has rendered yet ("No preview yet."); a live render in progress shows
the busy indicator and no sentence; a problem hold keeps "Showing the last
preview". This amends issue [#1022](https://github.com/aidenlx/zotlit/issues/1022)'s story 4, which had Stop say "Live preview
paused" on both hosts: no Stop control shipped, so the line restated the
select. The web Workbench keeps its own Run and paused line in its controls
and gains only the corrected stale wording.

## Considered options

- **Keep the selects in content, tighten the rows**: keeps every setting
  visible, and keeps about 160 px of chrome above the note in a pane whose
  task is inspecting the note.
- **Pane menu only, no view actions**: the smallest change, and two clicks
  to switch format while reading, with no visible cue that Markdown exists.
- **Two independent menu settings, mode and scope**: mirrors the stored
  flags, and offers four combinations of which the reader can tell three
  apart.
- **A pressed-state toggle for the note choice**: the Profile Editor's
  Advanced action uses it, but the note choice is a view of the result, and
  the reading-view idiom names the view the next press shows.
- **Keep the permanent "Live preview paused" line**: matches 1022's wording,
  and stays on screen while nothing needs rendering.
- **Drop On demand from the Obsidian pane**: fewest states, and removes the
  escape hatch for a slow template on a slow machine.

## Consequences

- `@zotlit/workbench/ui` exports `ResultBody`, the result without its
  heading, for a host that composes its own; `ResultColumn` is the header
  plus the body for the web page.
- `RenderSchedulerState` carries `staleReason` beside `stale`; the stale
  sentence is chosen by reason, on both hosts.
- The Obsidian mock records disabled menu items and stamps `data-icon`, so
  pane tests drive the pane menu and header actions rather than selects.
- WORKBENCH-DESIGN.md records the resulting rules under "Native chrome
  carries rare choices", and names "Select stack", "Setting as status", and
  "Card in a pane" as recognizable design failures.
- The web Workbench still shows "Live preview paused" in its own controls
  beside the new notice; retiring it is a web-side follow-up.

### Preview selections

Use the native suggester for Item and annotation selection. Interrupting a
selection closes the chooser, and dismissal returns no choice. Offer Sample
Items, up to three recently updated parent Items, and library search. Read
the recent list once while it is visible and cancel the read if it closes.
Search returns parent Items. Offer annotations from the selected Item and
samples. Where the native header is hidden, show the selected data's own
name. Use visible headings to label each group for assistive technology.

[Chooser](../../packages/template-workbench/src/obsidian/editor/item-choice.ts) ·
[Selection UI](../../packages/template-workbench/src/obsidian/editor/selection.tsx)

### Preview rendering in the native pane

Render Note Preview chrome in the interface type scale and use the note
theme for Markdown. The sheet uses Obsidian's reading-view classes and file
margins, with the panel as the only scroller. In the inline card the card
owns the inset, so it adjusts native reading-view and block margins. Use
the native active icon style for the preview toggle. Keep the disclosure
title and summary inside its inset, and allow translated labels to wrap
despite Obsidian's unlayered button rule. Keep the error role across color
schemes and preserve the report's lines.

The Markdown post-processor runs after Obsidian creates internal embed
spans and before it loads them. In a preview, replace note embeds with
placeholders that name the link and report whether the note exists. A
missing link can name a note even without a file extension. This keeps
embedded note contents and the create action out of the preview while
leaving the native rendering of other existing files in place. Report
Item read failures for an absent Item, a child Item, or an unavailable
database.

[Preview styles](../../packages/template-workbench/src/desktop/view/preview-panel.css) ·
[Embed post-processor](../../packages/template-workbench/src/obsidian/view/embed-placeholder.ts)

### Desktop rendering and presentation

Use the leaf's scheduler and host model for Note, Annotation, Citation, and Shared Partial previews. Read selected example data from its caller's contract root. Built-in Citation examples carry their data directly, and connected Citation previews share the Explorer's live data read. Preserve the render metadata, source path, and Citation spans with retained output. The sticky header and body show the same render. Match scroll padding to the header height so a tab stop remains visible. The reading mode and settings controls use the native view chrome.

Render the filename independently from the body. Assume an available name in Preview and leave collision resolution to the vault's save path. Use the runtime clock and the same preparation pipeline as a write. Consume the body already returned by preparation or composition. A second render can change a stateful JavaScript template's result. When composition refuses a failing property, show the property diagnostic and render the body the refused operation did not produce. In Update, apply the Managed Region and stamp Properties on the existing note in memory.

Use Obsidian's Markdown renderer with a lifecycle per output. Unload the lifecycle and its children when the output is replaced. The native pusher and footer keep first- and last-section styling consistent with Reading view. Check for a blank result after native rendering as well as before. Retain source provenance for links and apply the saved-note Citation replacements using the draft's formatted occurrence positions. Show Properties regardless of the vault's document display preference. Open the block when the Properties tab requests it, then let the reader control the fold.

Parse draft citations from the current draft and keep their presentation
out of the saved-note cache. An empty link list identifies a literal
citation. Use the render outcome to select the diagnostic and read the
current formatted output after a successful hold, since invalidation may
have replaced it. When the engine is absent, preserve the authored citation
and show the setup hint appropriate to the engine status.

Preview fixtures run each render on its own runner. Register vault
Partials before Template starts so the first scan finds them. Open the
test database before the view subscribes, as the plugin worker does.
The fixture adapts Promise-based test inputs to the live service boundary.
