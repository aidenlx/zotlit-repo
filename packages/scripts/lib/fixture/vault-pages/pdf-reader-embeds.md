---
title: PDF reader embeds
---
# PDF reader embeds

These checks need the ZotLit PDF reader to take over PDFs. Go to **Settings →
ZotLit → Reader** and turn on **Open all PDFs in the ZotLit reader**, then open
this note again.

| Action | Expected result |
| --- | --- |
| Look at the first embed in **Embeds**. | It shows `excerpt-rendering.pdf` in the reader at page 1. The embed is as tall as one page and its toolbar, with **More options** at the end of the toolbar. |
| Look at the second embed. | It opens at page 2. |
| Look at the third embed. | It shows 300 pixels of the PDF below its toolbar. |
| In Live Preview, select text in an embed. | The text is selected. The cursor in the note does not move. |
| Select **More options** in an embed toolbar. | The menu shows **Open**, then Obsidian's link menu. **Open** opens the PDF in the reader view. |
| Hover the link in **Link** with Ctrl (Windows, Linux) or Command (macOS) held. | The hover preview shows the PDF in the reader at page 3, with no toolbar. |
| Move this note to a new window. | The embeds stay in the reader and show the same pages in the new window. |
| Open `pdf-reader-embeds.canvas`. | The card shows page 2 in the reader. Select the card, then drag across its text: the text is selected and the card does not move. |
| Export this note to PDF. | Each embed prints as one image of its page: page 1, page 2 and page 1. |
| Turn **Open all PDFs in the ZotLit reader** off, then open this note again. | The embeds show Obsidian's own PDF embed. A PDF opened from the file explorer opens in Obsidian's PDF view. |

Two desktop checks cover this page. `pnpm e2e --project=desktop
src/reader.e2e.ts -t R-3` checks the three embeds, **More options**, the hover
preview, the Live Preview embed of `#height=300`, the move to a new window and
the canvas card's reader in ZotLit Reader alone, and `-t R-5` checks the turn
back to Obsidian's PDF embed when **Open all PDFs** is off.
`-t E-15` checks a real text drag in a Live Preview embed with the note's
cursor kept, the hover preview, a real text drag on the canvas card, and the
turn back to Obsidian's embed when the setting is off, also in ZotLit Reader
alone. The export to PDF stays
a manual check.

## Embeds

![[excerpt-rendering.pdf]]

![[excerpt-rendering.pdf#page=2]]

![[excerpt-rendering.pdf#height=300]]

## Link

[[excerpt-rendering.pdf#page=3]]
