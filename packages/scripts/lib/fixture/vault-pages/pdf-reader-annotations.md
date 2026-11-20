---
title: Annotations in the ZotLit PDF reader
---
# Annotations in the ZotLit PDF reader

These checks use ZotLit's annotation tools in the ZotLit PDF reader on the
Rougier paper, whose Zotero Attachment has eight Annotations on pages 1 and 2.
Before you start, go to **Settings → ZotLit → Reader** and turn off **Open all
PDFs in the ZotLit reader**. The first section asks you to turn it on part-way.
Keep it on for the sections after it. The last section turns the setting off
again.

The ZotLit opens are covered by the desktop check
`pnpm e2e --project=desktop src/zotlit-pdf-reader.e2e.ts -t E-18`, the keyboard
focus and the tab behind the **Zotero library** view by the case "opens a PDF
from the Library View card" in the same file, the focus that moves away while a
PDF loads by the case "keeps the focus" in `src/reader.e2e.ts`, and the
Form XObject PDF by the Paired Run check
`pnpm e2e --project=paired src/paired-run.e2e.ts -t E-1`, which compares the
highlight's Page Label and Sort Index with the values Zotero's own reader
gives. The desktop check, `pnpm e2e --project=desktop src/zotlit-pdf-editor.e2e.ts`,
covers the annotation links, the Creation Toolbar on a narrow tab, the PDFs
with no tools, the password prompt, the pop-out window and the plugin reload.
It also checks the annotation links in the tab that already shows the PDF and
in a background tab, which loads the PDF only when the tab shows, a background
tab after ZotLit is turned off and on, a reload after the file changes on disk,
links that name a second Attachment of the same file, and, with the setting
off, an annotation link from a tab of Obsidian's own PDF view, which then shows
the ZotLit PDF reader. The highlight popup and the popup of a selected
Annotation stay manual checks.

## Opens from ZotLit

ZotLit opens a PDF in the ZotLit PDF reader with **Open all PDFs in the ZotLit
reader** off and with it on. Do these checks with the setting off. Then turn the
setting on, close every tab of `rougier-2014.pdf`, and do them again.

| Action | Expected result |
| --- | --- |
| Open the **Zotero library** view. On the card of *Ten Simple Rules for Better Figures*, select **Open PDF**. | `rougier-2014.pdf` opens in the ZotLit PDF reader, with its Annotations and the Creation Toolbar. |
| Open the literature note of the Rougier paper and run the command **ZotLit: Open PDF**. | The PDF opens in the ZotLit PDF reader. |
| In the **Zotero annotations** view, select the page of an Annotation. | The PDF opens in the ZotLit PDF reader on that page, and the Annotation is selected. |
| Open `rougier-2014.pdf` from the file explorer. | With the setting off, it opens in Obsidian's own PDF view, with no Creation Toolbar and no Annotations. With the setting on, it opens in the ZotLit PDF reader. |
| Close the PDF's tab. On the card in the **Zotero library** view, select **Open PDF**. When the PDF shows, press `Page Down`. | The PDF scrolls down one screen: the reader has the keyboard focus. |
| Close the PDF's tab. On the card, select **Open PDF**, and at once select the search box of the **Zotero library** view, before the PDF shows. Type `figure`. | The word goes into the search box. The reader does not take the keyboard focus when the PDF shows. On a fast computer the PDF can show first; then try again. |
| Go to **Settings → Files and links** and turn off **Always focus new tabs**. Close the PDF's tab. In the **Zotero library** view, select the row of *Ten Simple Rules for Better Figures* and press `Ctrl+Shift+Enter` (Windows, Linux) or `Command+Shift+Enter` (macOS). Turn **Always focus new tabs** on again at the end. | The PDF opens in a new tab behind the **Zotero library** view, which stays in front. |

## Text inside a Form XObject

`attachments/form-xobject.pdf` draws all of its text inside a Form XObject. Its
Zotero Attachment, **Form XObject PDF**, belongs to the Item *A preprint whose
Venue is its repository*. Open the **Zotero library** view, select that Item's
row, select **Open PDF** on its card and choose `form-xobject.pdf`. Delete the
new highlight in Zotero at the end.

| Action | Expected result |
| --- | --- |
| Look at the tab. | `form-xobject.pdf` opens in the ZotLit PDF reader, with the Creation Toolbar. |
| Select a line of text in the middle of page 1. | The popup offers a highlight and an underline. |
| Select **Highlight**. Then open **Form XObject PDF** in Zotero and look at the new highlight. | Zotero shows the highlight on the same line, with page `1` and the same text. |

## Annotation links

| Action | Expected result |
| --- | --- |
| `Ctrl`-select (Windows, Linux) or `Command`-select (macOS) [[attachments/rougier-2014.pdf#page=3&zt-annotation=FDRFQ7C2&zt-attachment=RGRPDF24\|the image on page 2]]. | A new tab opens the PDF in the ZotLit PDF reader. It shows page 2, not page 3, and the image Annotation there is selected, with no popup. |
| Come back to this note and `Ctrl`-select or `Command`-select [[attachments/rougier-2014.pdf#page=3&zt-annotation=PUPR5FG5\|the first highlight]]. | A new tab shows page 1, and the highlight "Identify Your Message" is selected. |
| Come back to this note and `Ctrl`-select or `Command`-select [[attachments/rougier-2014.pdf#page=2\|page 2]]. | A new tab shows page 2, and no Annotation is selected. |

## Tools

Open [[attachments/rougier-2014.pdf]].

| Action | Expected result |
| --- | --- |
| Look at the right end of the reader's toolbar. | The Creation Toolbar shows the highlight, underline, note, text, image and ink tools, each with its colour menu, and the button that hides the Annotations. On a narrow tab the toolbar wraps onto a second row. |
| Select a line of text on page 1. | The popup offers a highlight and an underline in the tool colours. |
| Press `Escape`. Select an Annotation on page 1. | The popup of that Annotation opens over it. |
| Open [[attachments/pdf-reader/chrome.pdf]]. | It opens in the ZotLit PDF reader with no Creation Toolbar and no Annotations: no Zotero Attachment keeps this file. |
| Open [[attachments/pdf-reader/password.pdf]]. Type `zotlit` and select **Open**. | The reader asks for a password first, then shows the PDF. It has no Creation Toolbar. |

## Windows and plugin reload

Open [[attachments/rougier-2014.pdf]] and go to page 2.

| Action | Expected result |
| --- | --- |
| Drag the tab out of the window, or select **Move to new window** in the tab's menu. | The new window shows the PDF on the same page with its Annotations. |
| Move the tab back. In **Settings → Community plugins**, turn ZotLit off and on again. | The tab shows the PDF in the ZotLit PDF reader again, with its Annotations and the Creation Toolbar. No error shows in the developer console (`Ctrl+Shift+I` or `Command+Option+I`). |

## Annotation links with the setting off

Go to **Settings → ZotLit → Reader** and turn off **Open all PDFs in the ZotLit
reader**. Close every tab of `rougier-2014.pdf`.

| Action | Expected result |
| --- | --- |
| `Ctrl`-select or `Command`-select [[attachments/rougier-2014.pdf#page=3&zt-annotation=FDRFQ7C2&zt-attachment=RGRPDF24\|the image on page 2]]. | A new tab opens the PDF in the ZotLit PDF reader. It shows page 2, and the image Annotation there is selected. |
| Come back to this note and `Ctrl`-select or `Command`-select [[attachments/rougier-2014.pdf#page=1&zt-attachment=RGRPDF24\|the Attachment at page 1]]. | A new tab opens the PDF in the ZotLit PDF reader at page 1, with the Creation Toolbar and no Annotation selected. |
| Come back to this note and `Ctrl`-select or `Command`-select [[attachments/rougier-2014.pdf#page=2\|page 2]]. | A new tab opens the PDF in Obsidian's own PDF view at page 2, with no Creation Toolbar. |
