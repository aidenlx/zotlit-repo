---
title: ZotLit with ZotLit Reader
---
# ZotLit with ZotLit Reader

Use this page in the Fixture Vault, which installs ZotLit Reader and then
ZotLit (`docs/fixture.md` → **Use the Fixture Vault**). ZotLit has no PDF
reader of its own: it adds its Zotero annotations to ZotLit Reader.

| Action | Expected result |
| --- | --- |
| Open **Settings → Community plugins**. | ZotLit Reader is listed before ZotLit, and both are on. **Settings → ZotLit → Reader** has no **Open all PDFs** row; that row is in **Settings → ZotLit Reader → Reader**. |
| Open the Annotation View, then click the page chip of the image Annotation on page 2 of the Rougier paper (`attachments/rougier-2014.pdf`). | The PDF opens in a ZotLit Reader tab on page 2, with the Annotation's mark drawn and selected. The Creation Toolbar shows in the reader's toolbar. The Annotation View shows the cards of that PDF. |
| Keep that tab open and reload the window (**Reload app without saving**). | The tab comes back in ZotLit Reader with the marks and the Creation Toolbar. The developer console shows no error. |
| Close Obsidian, put `zotlit` before `zotlit-reader` in `.obsidian/community-plugins.json`, and start Obsidian with the tab open. Put the order back afterwards. | ZotLit starts first. The tab comes back in ZotLit Reader with the marks and the Creation Toolbar, and the developer console shows no error. |
| With a ZotLit Reader tab open, turn ZotLit Reader off, then on again in **Settings → Community plugins**. Then open another Annotation from the Annotation View. | The open tab comes back in ZotLit Reader with ZotLit's marks and Creation Toolbar. The new tab has them too. **Open all PDFs** stays off. |
| With a ZotLit Reader tab open, turn ZotLit off, then on again. | While ZotLit is off, the marks and the Creation Toolbar leave the tab; the tab stays on its page, and you can still scroll and change pages. When ZotLit is on again, the marks and the toolbar come back. No error shows. |
