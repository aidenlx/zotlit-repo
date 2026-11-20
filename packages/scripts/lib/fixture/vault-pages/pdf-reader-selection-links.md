---
title: PDF reader selection links
---
# PDF reader selection links

Obsidian's own PDF view reads each link in the first table as the stated text:
it highlights that text when it opens the link. A `#selection=` link counts
text pieces the way Obsidian's PDF view splits a page. The PDF reader splits
some pages in a different way, so it converts each link to its own pieces
before it highlights the text, and it converts back when it copies a link.

These checks need the ZotLit PDF reader to take over PDFs. Go to **Settings →
ZotLit → Reader** and turn on **Open all PDFs in the ZotLit reader**, then open
this note again. With the takeover off, each link opens
in Obsidian's own PDF view and highlights the same text.

## Links in the indexes of Obsidian's PDF view

| Link | Expected result |
| --- | --- |
| [[attachments/selection-links/sakimas-song.pdf#page=5&selection=6,9,6,40\|Sakima's Song, page 5, one line]] | Page 5 opens. The highlight covers "Sakima was left with his little". |
| [[attachments/selection-links/sakimas-song.pdf#page=5&selection=2,18,4,14\|Sakima's Song, page 5, two lines]] | Page 5 opens. The highlight covers "They left home early" and "in the morning", on two lines. |
| [[attachments/rougier-2014.pdf#page=1&selection=35,0,48,7\|Rougier et al. 2014, page 1, first sentence]] | Page 1 opens. The highlight covers "Scientific visualization is classically defined as the process", below the author list. |
| [[attachments/rougier-2014.pdf#page=1&selection=140,0,140,26\|Rougier et al. 2014, page 1, heading]] | Page 1 opens. The highlight covers the heading "Rule 1: Know Your Audience". |
| [[attachments/selection-links/mock-form.pdf#page=1&selection=31,0,38,1\|Mock form, page 1]] | Page 1 opens. The highlight covers "示示例文字用于复现表单对象示例文字用于复现 示示例文字 示", the text that Obsidian's own PDF view highlights for this link. This PDF needs the character maps that Obsidian ships. |

## Links that the PDF reader cannot convert

| Link or case | Expected result |
| --- | --- |
| [[attachments/selection-links/sakimas-song.pdf#page=5&selection=9999,0,9999,4\|Sakima's Song, page 5, a link past the end of the page]] | Page 5 opens with no highlight. |
| A page whose text in Obsidian's PDF view is not the same as its text in the PDF reader, after all spaces and line breaks are removed. No PDF in the Fixture Vault has such a page; the Electron renderer test `packages/pdf-reader/src/obsidian/legacy-text.test.ts` covers this case. | A link to the page opens the page with no highlight. A selection on the page has no **Copy link to selection** in its menu, and **Copy as quote** ends with a link to the page (`#page=N`) only. |

## Links made in the PDF reader

| Action | Expected result |
| --- | --- |
| In the PDF reader, open `sakimas-song.pdf` at page 5. Select "They left home early in the morning", right-click the selection and select **Copy link to selection**. Paste the link below. | The pasted link opens page 5 with the same text highlighted. |
| Turn the takeover off, then open the pasted link. | Obsidian's own PDF view opens page 5 with the same text highlighted. |
| In the PDF reader, select a line on page 1 of `rougier-2014.pdf` and select **Copy as quote**. | The quote ends with a link that highlights the same line in the PDF reader and in Obsidian's own PDF view. |

The desktop check, `pnpm e2e --project=desktop src/reader.e2e.ts -t R-2`, partly
covers this page. It opens each link of the first table in Obsidian's own PDF
view and in the PDF reader, and checks that both highlight the expected text,
and that the link past the end of page 5 opens page 5 with no highlight. It
copies a link to a selection on `sakimas-song.pdf` and on `rougier-2014.pdf` with
**Copy link to selection**, opens it in Obsidian's own PDF view, and checks
that the view highlights the selected text. **Copy as quote** stays a manual
check on this page.
