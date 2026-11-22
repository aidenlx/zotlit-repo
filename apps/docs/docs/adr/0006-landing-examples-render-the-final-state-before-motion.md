# Landing examples render the final state before motion

## Context

The landing page illustrates a research workflow with sample app windows and recordings. The examples must read in static HTML, in English and Chinese, and at widths where the full stage cannot fit.

## Research desk and workflow

Build the six desk objects in HTML from the docs Fixture's Reproducibility collection. Use the plugin's message catalog for Last Activity and other app labels, and show Obsidian purple and Zotero annotation colors only in the app windows that depict them. Keep paper titles, creators, journals, citations, and references as research data across locales. Use the Library View order for the initial list and ascending year for the saved table. The ratings are Literature Note properties. Localize the draft prose around the citations and reserve extra room for the Chinese rating label. Represent the undemonstrated parts of the PDF with bars and use each tape label to name the task its object illustrates.

The desk is decorative, with its content covered by the headline and the workflow below. From 1280 px, place the objects on a 1440 by 832 stage that scales with the text. Scale the two side groups toward their outer edges to protect the headline gap and the final table column. Hang the note and Word page from the midpoint of the hero so they follow its height. Between 1024 and 1280 px, arrange the four leading pieces in a two-column layout below the text. Below 1024 px, stack the library sheet, table, and PDF.

Give each object separate layers for pointer drift and its drop and rotation. Read the hero bounds in the pointer event and batch writes to each object's translate property in one animation frame. The desk uses drift only with a fine pointer and motion enabled. The citation animation reuses one grid cell for the typed key and final citation and brings its reference in with the citation. Without motion both citations are present. The highlighter wraps with the title and sweeps only when motion is allowed. [Theme and motion](0003-font-fallbacks-preserve-layout-and-motion-is-progressive.md)

Put the tutorial first in the paired 44 px actions and open Lesson 1 directly. Keep Install as the secondary action. Stack the buttons below the small breakpoint. Link workflow steps to named lessons so the links make sense on their own. The five-step workflow uses its own labels and spacing, with wider line spacing for Chinese prose. Its 16:10 frames prerender their screenshots. For a case with a clip, mount its player once the frame is within 300 px of the viewport. The player owns seeking, playback, and the reduced-motion behavior. The Word case currently supplies a still.

## Collection-to-table demo

Start the sequence in the Library View and show the save dialog before opening the query file. Reserve the final column tracks as soon as the table appears. Share the grid between header and rows with bounded tracks so cell content does not move later columns. Show fields in the list's second line until they move into their columns. Apply the year sort, then use cell focus to type the two Literature Note ratings. Show “No note” and the create action for papers with no note. At the 768 px split, CSS changes the tree, toolbar labels, and visible columns, so the first render agrees with the server HTML. Phones keep Title, Year, and rating.

Use one 19.8-second cycle with beats measured from its start. Start fading 650 ms before reset. Fill each caption bar over its beat and leave completed bars full. The finished frame shows every bar full. For transitions, sample current keyed positions before the React commit, including positions during a running animation. Cancel the running animations after the commit and read all destination positions before starting new animations. A nested keyed cell moves relative to its row to avoid double movement. New entries fade and rise. Animate transforms and opacity.

Prerender the finished frame. Reduced motion keeps it still. With motion enabled, start at the collection and repeat while at least half the demo is visible. The pause button stops it on the finished frame, and pressing Play starts again from the collection. The JavaScript loop currently keeps running below half visibility once started and misses live reduced-motion changes. [Visibility and motion follow-up](https://github.com/aidenlx/zotlit-repo/issues/109)

Use the recording coordinator to give the demo and recordings one playback turn. A recording deliberately paused in view can hold the turn against automatic starts. A running demo rests when displaced. It should wait to resume if still eligible. [Demo resumption follow-up](https://github.com/aidenlx/zotlit-repo/issues/110)

See [the landing design](../../DESIGN.md), `apps/docs/src/components/landing/`, and [shared recording playback](0005-lessons-prerender-complete-and-load-recordings-on-demand.md).
