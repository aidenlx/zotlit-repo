---
title: ZotLit without ZotLit Reader
---
# ZotLit without ZotLit Reader

Use this page in the Fixture Vault (`docs/fixture.md` → **Use the Fixture
Vault**). ZotLit opens PDFs in ZotLit Reader when it is on. Without it, ZotLit
opens them in Obsidian's own PDF view and tells you once how to get the
annotation tools.

Each row says whether ZotLit Reader is on, off or removed; set that in
**Settings → Community plugins** first. To see the notice again,
run `app.saveLocalStorage("zotlit-reader-fallback-notices", null)` in the
developer console.

| Action | Expected result |
| --- | --- |
| Open **Settings → ZotLit → Reader** with ZotLit Reader on. | The first row, **ZotLit Reader**, says it is connected and has no button. |
| Turn ZotLit Reader off, then open **Settings → ZotLit → Reader**. | The row asks you to turn on ZotLit Reader. **Turn on** opens ZotLit Reader's page in the community plugin browser. |
| Remove ZotLit Reader, then open **Settings → ZotLit → Reader**. | The row asks you to install ZotLit Reader. **Install** opens ZotLit Reader's page in the community plugin browser. |
| With a ZotLit Reader that does not support this ZotLit's contract version, open **Settings → ZotLit → Reader**. | The row says the two versions do not work together and names the plugin to update; **Update** opens that plugin's page. |
| With ZotLit Reader off, select **Open PDF** on the Rougier paper in the Library View. | The PDF opens in Obsidian's own PDF view. One notice says the PDF opened in Obsidian's PDF view, with a **Turn on** button. No error shows in the developer console. |
| Select **Open PDF** again. | The PDF opens in Obsidian's PDF view, and no notice shows. |
| Open the Annotation View and click the page chip of the image Annotation on page 2 of the Rougier paper (`attachments/rougier-2014.pdf`). | The PDF opens in Obsidian's PDF view on page 2. |
| With ZotLit Reader on, open that Annotation, then turn ZotLit Reader off with the tab open. Click the page chip again. | ZotLit logs no error. The PDF opens in Obsidian's PDF view on page 2, and the notice shows if it did not show for "turned off" before. |
| Open the Welcome View (**Welcome & help**) with ZotLit Reader off. | The setup steps end with **ZotLit Reader**, which says to turn it on and has a **Turn on** button. With ZotLit Reader on, the step is done and says **Connected**. |
