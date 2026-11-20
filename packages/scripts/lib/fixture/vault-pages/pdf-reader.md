---
title: ZotLit PDF reader
---
# ZotLit PDF reader

These checks open the test PDFs in `attachments/pdf-reader/` in the ZotLit PDF
reader. First go to **Settings → ZotLit Reader → Reader** and turn on **Open
all PDFs**. Then select each link below. Turn the setting off again at the end.

The desktop check, `pnpm e2e --project=desktop src/reader.e2e.ts`, covers each
table below in ZotLit Reader alone, with its own **Open all PDFs** setting
(`-t R-5`) and the password prompt (`-t E-14`).

## The setting

| Action | Expected result |
| --- | --- |
| With the setting off, open `chrome.pdf` from the file explorer. | It opens in Obsidian's own PDF view. Its tab has no ZotLit toolbar. |
| Turn the setting on, then open `chrome.pdf` from the file explorer again. | It opens in the ZotLit PDF reader: the toolbar has a sidebar button, zoom buttons, a display menu and a page box. |
| Open [[pdf-reader-embeds]]. | Its embeds, its hover preview and its canvas card show the ZotLit PDF reader (see that page). |
| Turn the setting off. | PDFs that you open next open in Obsidian's own PDF view. A ZotLit PDF reader tab that is still open stays as it is. |

## Toolbar

Open [[chrome.pdf]].

| Action | Expected result |
| --- | --- |
| Look at the page box. | It shows the page label `i` and `(1 of 3)`. |
| Type `1` in the page box and press Enter. | The reader goes to the second page, label `1`, `(2 of 3)`. |
| In the display menu, turn off **Show page labels**, type `3` and press Enter. | The page box is a number box with `of 3`, and the reader goes to page 3. |
| Select **Zoom out** until it turns off, then **Zoom in** until it turns off. | Zoom stops at 10% and at 1000%. |
| In the display menu, select **Fit width**, **Fit height**, **Two-page (odd)**, **Two-page (even)** and **Single page**. | The pages fit the width, then the height, then show two by two, starting with page 1 and then with page 2, then one by one. |
| Select **Adapt to theme** in the display menu. | The menu item has a check mark. Open the PDF in another tab: the item is still checked. |

## Sidebar

Open [[chrome.pdf]].

| Action | Expected result |
| --- | --- |
| Select the sidebar button. | The thumbnails show, labelled `i`, `1` and `2`. Select it again to close the sidebar. |
| Right-click the second thumbnail and select **Copy link to page 2**. | The clipboard holds `[[chrome.pdf#page=2\|chrome, page 2]]`. |
| Select the third thumbnail. | The reader goes to page 3, and the thumbnail is marked. |
| In the sidebar menu, select **Table of contents**. | The outline shows Introduction `i`, Methods `1` and Project site. |
| On page 3, select **Reveal page in table of contents** in the sidebar menu. | Methods opens and Sampling `2` is marked. |
| Right-click Introduction and select **Copy link to “Introduction”**. | The clipboard holds `[[chrome.pdf#page=1&offset=72,720,0\|chrome, Introduction]]`. |
| Drag the edge of the sidebar to the left and to the right. | The sidebar stops at 140 pixels and at half the reader's width. Open the PDF again: the width is kept. |

## Find

Open [[chrome.pdf]] and select the reader.

| Action | Expected result |
| --- | --- |
| Press `Ctrl+F` (Windows, Linux) or `Command+F` (macOS) and type `fox`. | The find bar shows `1 of 4 matches` and every match is highlighted. |
| Press `F3`, then `Shift+F3`, `Ctrl+G` or `Command+G`, `Ctrl+Shift+G` or `Command+Shift+G`, `Enter` and `Shift+Enter`. | The current match goes 2, 1, 2, 1, 2, 1. |
| In **Search options**, turn on **Whole words**. Then select **Match case**. | `1 of 3 matches`, then `1 of 2 matches`. |
| Turn both off and search for `zebra`. | The find bar shows `No matches`. |
| Search for `cafe`, then turn on **Match diacritics**. | `1 of 2 matches`, then `1 of 1 match`. |
| Press Escape. | The find bar closes and the highlights go. |
| Open [[navigation.pdf]] and search for `e`. | The find bar shows `1 of more than 1000 matches`, and **Match diacritics** is still on. |

## Context menus and PDF annotations

Open [[chrome.pdf]].

| Action | Expected result |
| --- | --- |
| Select `fox and the` in the line "The fox and the Fox." and right-click it. | The menu shows **Look up “fox and the”** (macOS only), **Copy**, **Copy as quote** and **Copy link to selection**. **Copy as quote** copies `> fox and the`, an empty line and a link with `#page=1&selection=`. |
| Select the link "Go to page three". | The reader goes to page 3. |
| Select the link "Visit the project page". | `https://example.org/paper` opens in your browser. |
| On page 2, select the highlighted sentence. | A popup shows "Check this sentence.", Ada Lovelace and a date. Its copy button copies the sentence, a link with `#page=2&annotation=9R` and the comment. |
| Right-click the highlighted sentence. | The menu shows **Copy annotation** and **Copy link to annotation**. |
| Open [[forms.pdf]]. | The text field after "Reviewer:" shows "Ada Lovelace", and `https://example.org/auto` in the first line is a link. |

## Links into a PDF

Select each link. It lands in the reader tab that shows `navigation.pdf`.

| Link | Expected result |
| --- | --- |
| [[navigation.pdf#page=3]] | Page 3 at its top. |
| [[navigation.pdf#page=4&offset=0,300,0]] | Page 4, scrolled so the point 300 points above its bottom is at the top of the reader. |
| [[navigation.pdf#page=2&selection=2,5,4,10]] | Page 2 with the linked text highlighted. |
| [[navigation.pdf#page=4&annotation=5R&selection=0,0,1,3]] | Page 4 with the note annotation highlighted, and no text highlight. |
| [[navigation.pdf#chapter-six]] | Page 6, at the named destination. |
| [[navigation.pdf#zoom=200]] | The zoom changes to 200% on the same page. |
| [[navigation.pdf#search=line]] | The find bar opens with `line` and every match highlighted. |

## Reading position and input

Open [[navigation.pdf]].

| Action | Expected result |
| --- | --- |
| Go to page 5, scroll a little, open the thumbnails, then close the tab and open the PDF again. | It opens at the same place on page 5 with the thumbnails open, at **Fit width**. |
| Choose **Two-page (odd)**, then open [[chrome.pdf]]. | `navigation.pdf` keeps two pages, and `chrome.pdf` shows one page. |
| Open `navigation.pdf` at page 6, open `chrome.pdf` in the same tab, then go back and forward. | Back shows `navigation.pdf` at page 6. Forward shows `chrome.pdf`. |
| Hold Ctrl or Command and turn the mouse wheel over the text, or pinch on a trackpad. | The zoom changes, and the text under the pointer stays under the pointer. |
| At **Fit width**, press the right and left arrow keys. | The reader turns one page forward and back. At a fixed zoom the arrow keys do not turn the page. |

## Rendering and theme

| Action | Expected result |
| --- | --- |
| Open [[standard-fonts.pdf]]. | Each of the 14 lines shows in its own standard font. |
| Open [[jbig2.pdf]] and [[jpx.pdf]]. | A black square, and a mid-grey square. |
| Open [[password.pdf]]. | The reader asks for a password. `wrong` shows "Invalid password". `zotlit` opens the empty page. **Cancel** shows that the PDF stays closed. |
| Open [[pdf-reader-theme.pdf]], turn on **Adapt to theme** in the display menu, then switch Obsidian to the dark theme. | The toolbar and the area around the page use the dark theme colors. The page turns dark with light text, and the red picture keeps its color. [[pdf-reader-theme]] has every theme case. |
| Turn the setting off and open `excerpt-rendering.pdf` from the file explorer. Turn the setting on and open it again in a new tab. | The first tab is Obsidian's own PDF view and the second is the ZotLit PDF reader. Both show the same pages with the same text. |
