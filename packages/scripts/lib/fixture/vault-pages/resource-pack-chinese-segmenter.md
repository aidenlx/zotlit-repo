---
title: Chinese segmenter from the Resource Pack
---
# Chinese segmenter from the Resource Pack

Use this page in the Fixture Vault (`docs/fixture.md` → **Use the Fixture
Vault**), opened with `--install zotlit-resources` after
`pnpm --filter @zotlit/resources build:dev`. That installs the ZotLit Resource
Pack and leaves it turned off, the state the pack works in. The **Chinese
segmenter** row is in **Settings → ZotLit → Zotero**, under **Search**.

The row reads the pack each time it is shown: close and open the Zotero page
after each change of the pack. To change the pack file, edit
`.obsidian/plugins/zotlit-resources/main.js` in the vault folder; to restore
it, run the build and open the vault again.

| Action | Expected result |
| --- | --- |
| Open **Settings → ZotLit → Zotero** with the pack installed and turned off. | The row says **Ready, from ZotLit Resource Pack** and the pack's version. It has one button, **Open in Community plugins**. |
| Turn the pack on in **Settings → Community plugins**, then open the row. | Obsidian shows no error. The row says the same as with the pack turned off. |
| Remove the pack (delete its folder and restart Obsidian), then open the row. | The row says the ZotLit Resource Pack plugin is not installed, and that until then search splits Chinese titles with built-in rules. |
| Select **Open in Community plugins**. | Obsidian's community plugin browser opens on the page of ZotLit Resource Pack (`obsidian://show-plugin?id=zotlit-resources`). |
| In the pack file, change `"compat":1` on line 1 to `"compat":0`. Open the row. | The row says the installed pack is too old and asks you to update ZotLit Resource Pack. |
| Change the value to `"compat":2`. Open the row. | The row says the installed pack is too new and asks you to update ZotLit. |
| Restore `"compat":1`, then change one letter in the long line near the end of the file. Open the row. | The row says the file of ZotLit Resource Pack is damaged and asks you to uninstall it and install it again. |
| Replace the pack file with the text `module.exports = {};`. Open the row. | The row says the file is damaged, as in the row before. |
| With the pack installed, search the Library View for `流域` when the library holds an Item with the title `长江流域的城市化研究`. | The Item is in the results. With no pack, `流域` finds nothing and `长江流域` finds the Item. |

The Fixture holds no Item with a Chinese title of several words. The desktop
check adds one on a data fork (`docs/fixture.md` → **Write to a data fork**)
and covers the search with the pack, the search with no pack, the row with no
pack and its button:
`pnpm e2e --project=desktop src/query-cli.e2e.ts -t Chinese`. The unit suite
`packages/plugin-services/src/obsidian/managed-binary/pack-row.test.ts` covers
the text of each row state. Each refusal of the pack is in ZotLit's log under
`item-lookup` → `segmenter`, with its reason.
