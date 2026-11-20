---
title: ZotLit Reader open all PDFs
---
# ZotLit Reader: open all PDFs

Use this page in a vault with ZotLit Reader and no ZotLit (`docs/fixture.md`
→ **Use the Fixture Vault**). The **Open all PDFs** row is in **Settings →
ZotLit Reader → Reader**.

| Action | Expected result |
| --- | --- |
| Open the settings of a new install. | **Settings → ZotLit Reader** shows the **Reader** page before **Advanced**. **Open all PDFs** is on. |
| Open `attachments/pdf-reader/chrome.pdf` from the file explorer. | The PDF opens in ZotLit Reader, with its toolbar. |
| Turn **Open all PDFs** off, then open the PDF from the file explorer again. | The PDF opens in Obsidian's own PDF view. The embeds in `pdf-reader-embeds.md` show Obsidian's own PDF embed. |
| Turn **Open all PDFs** on, then open the PDF again. | The PDF opens in ZotLit Reader. The embeds show ZotLit Reader. |
| Restart Obsidian with the row off. | The row is still off and PDFs open in Obsidian's own PDF view. The plugin's `data.json` holds only `__VERSION__` and `reader.open-all-pdfs`. |
| With the row on, turn ZotLit Reader off in **Settings → Community plugins**. | Open PDF tabs close their reader. PDFs, embeds and hover previews open in Obsidian's own PDF view. |
| Turn ZotLit Reader on again. | PDFs, embeds and hover previews open in ZotLit Reader again. |

The desktop check, `pnpm e2e --project=desktop src/reader.e2e.ts -t R-5`,
covers the row off and on, the plugin turned off with the row on, and the
plugin turned on again. The integration test `apps/reader/src/reader.integration.test.ts`
covers the new install, the restart with the row off, the `data.json` keys and
the notice where Obsidian has no way to open all PDFs in ZotLit Reader.
