---
title: PDF reader theme
---
# PDF reader theme

These checks need the ZotLit PDF reader to take over PDFs. Go to **Settings →
ZotLit Reader → Reader** and turn on **Open all PDFs**, then open
this note again.

`pdf-reader-theme.pdf` has one page: a dark blue rectangle, a black letter
"H", a red picture at the right and a text field that says "Field text". Open
it in the reader view, or look at the embed below. **Adapt to theme** is in the
display menu of the reader toolbar and in **More options** of the reader view.

| Action | Expected result |
| --- | --- |
| In the light theme, with **Adapt to theme** off, look at the page. | The page is white. The rectangle is dark blue, the "H" is black and the picture is red. |
| In the light theme, turn **Adapt to theme** on. | The page takes the background colour of the theme. With the default light theme it stays white, and no colour on the page changes. The menu entry shows a check mark. |
| Change to the dark theme while **Adapt to theme** is on. | The page changes without a reload. It takes the dark background colour of the theme. The "H" turns white and the rectangle turns light blue. The picture stays the same red. The text field shows light text on a dark field. |
| Open the sidebar and look at the page thumbnail in the dark theme. | The thumbnail shows the same dark page as the view. |
| Change back to the light theme. | The page is light again, with its first colours. |
| With **Adapt to theme** on, open another tab in front of the PDF, change the theme, then go back to the PDF tab. | The PDF shows the colours of the new theme at once, with no scroll. |
| In the dark theme, turn **Adapt to theme** off. | The page is white with its first colours, as in the light theme. |
| With **Adapt to theme** on, close the PDF and open it again. | **Adapt to theme** is still on, and the page opens in the colours of the theme. |
| In the light theme, with **Adapt to theme** on, turn on a CSS snippet with `body { --pdf-page-background: #f4ecd8; }`. | The page turns sepia. The "H" stays black and the rectangle stays dark blue. |

The desktop check, `pnpm e2e --project=desktop src/reader.e2e.ts -t R-4`,
covers the first three rows, the change back to the light theme and the
background tab on this PDF in the reader view of ZotLit Reader alone, and
`-t E-13` checks the `--pdf-*` variables and that **Adapt to theme** stays on
for the next reader. The Electron test
`packages/pdf-reader/src/core/theme/theme.test.ts` checks the colour of each
part on a light, a sepia and a dark page, the text field, the thumbnail, and
that a theme event with no colour change does not repaint the page;
`packages/pdf-reader/src/core/persist/persist.test.ts` checks that the option
is kept after a reopen. The snippet row stays manual.

## Embed

![[pdf-reader-theme.pdf]]
