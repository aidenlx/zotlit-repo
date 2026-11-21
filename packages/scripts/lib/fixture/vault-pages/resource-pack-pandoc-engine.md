---
title: Pandoc engine from the Resource Pack
---
# Pandoc engine from the Resource Pack

Use this page in the Fixture Vault (`docs/fixture.md` → **Use the Fixture
Vault**), opened with `--install zotlit-resources` after
`pnpm --filter @zotlit/resources build:dev`. That installs the ZotLit Resource
Pack and leaves it turned off, the state the pack works in. The **Pandoc
engine** row is in **Settings → ZotLit → Citations**, under **Formatting**.

Choice models are estimated in [@Hensher2011].

The row reads the pack each time it is shown: close and open the Citations page
after each change of the pack. A render or an export reads the pack when it
first asks for the engine. To change the pack file, edit
`.obsidian/plugins/zotlit-resources/main.js` in the vault folder; to restore
it, run the build and open the vault again. To remove the pack, uninstall it
in **Settings → Community plugins**. The page `resource-pack-session.md` has
the cases in which Obsidian installs, updates or uninstalls the pack while it
runs, and the notice.

## The row

| Action | Expected result |
| --- | --- |
| Open **Settings → ZotLit → Citations** with the pack installed and turned off. | The row says **Ready, from ZotLit Resource Pack** and the pack's version. It has one button, **Open in Community plugins**. |
| Read the row's description. | It says that ZotLit Resource Pack redistributes Pandoc under the GNU General Public License, version 2 or later. The link **Pandoc source code** goes to `https://github.com/jgm/pandoc`. |
| Remove the pack, then open the row. | The row says the ZotLit Resource Pack plugin is not installed, and that until then references stay a plain list and the built-in export does not run. |
| Select **Open in Community plugins**. | Obsidian's community plugin browser opens on the page of ZotLit Resource Pack (`obsidian://show-plugin?id=zotlit-resources`). |
| In the pack file, change `"compat":1` on line 1 to `"compat":0`. Open the row. | The row says the installed pack is too old and asks you to update ZotLit Resource Pack. |
| Change the value to `"compat":2`. Open the row. | The row says the installed pack is too new and asks you to update ZotLit. **Open in Community plugins** now opens the page of ZotLit (`obsidian://show-plugin?id=zotlit`). |
| Restore `"compat":1`, then change one letter in the last long line of the file. Open the row. | The row says the file of ZotLit Resource Pack is damaged and asks you to uninstall it and install it again. |
| Write a pack that has no `pandoc-engine` entry (command B on the page `resource-pack-chinese-segmenter.md`). Open the row. | The row says the installed pack is too old and asks you to update ZotLit Resource Pack. |
| Write a pack whose `pandoc-engine` entry is not a WebAssembly module (command A on that page, with `pandoc-engine` as the last argument). Open the row. | The row says **Ready**: a status read does not start the engine. Run the export below: its notice says **It did not start:** and the reason. Open the row again: it says the same. |

## The export, with the network off

| Action | Expected result |
| --- | --- |
| With the pack installed, turn the network off. Open this page and run **ZotLit: Export note with citations**. Choose **HTML** and select **Export**. | The completion notice names `resource-pack-pandoc-engine.html` and the style. The file is next to this page and holds the formatted citation of Hensher 2011. Nothing is downloaded. |
| With no pack, run **ZotLit: Export note with citations**. | No dialog opens. A notice says that the built-in export needs the Pandoc engine of the ZotLit Resource Pack plugin, and that the plugin is not installed. Its button **Open in Community plugins** opens the page of ZotLit Resource Pack. |
| With a pack that is too old, too new or damaged, and not yet read in this session, run the export and select **Export**. | The dialog opens. After **Export**, the notice names the Resource Pack and gives the sentence of that state, the same as on the row. A second run gives the notice with no dialog. |
| With a pack that is too new, select **Open in Community plugins** in that notice. | Obsidian opens the page of ZotLit (`obsidian://show-plugin?id=zotlit`), the plugin to update. For the other states the button opens the page of ZotLit Resource Pack. |

## References and the Template Workbench preview

| Action | Expected result |
| --- | --- |
| With the pack installed, open the **References** Sidebar on this page. | The list holds the formatted reference of Hensher 2011. No banner shows. |
| With no pack, open the **References** Sidebar on this page. | The list is the plain list. The banner **Format these references** asks you to install the ZotLit Resource Pack plugin. Its button **Open in Community plugins** opens the pack's page. |
| Close the banner with its close button. Open another note, then this page again. | The banner stays closed until Obsidian restarts. |
| With a pack that is too old, too new or damaged, read the page in reading view, then look at the **References** Sidebar. | The warning banner **The Pandoc engine is unavailable** gives the sentence of that state. **Open settings** shows the **Pandoc engine** row. |
| With no pack, open a Literature Note template in the Template Workbench with a citation in its preview. | The citation stays as written. The hint asks you to install the ZotLit Resource Pack plugin. **Open settings** shows the **Pandoc engine** row. |

The desktop checks: `pnpm e2e --project=desktop src/walkthrough.e2e.ts -t 'exports a draft as HTML'`
exports from the installed pack, and
`pnpm e2e --project=desktop src/walkthrough.e2e.ts -t 'Resource Pack'` covers
the preview hint, the row and its button with no pack, and the preview after
the pack comes back. The unit suites
`packages/citations/src/obsidian/pandoc/engine-settings-row.test.ts`,
`packages/citations/src/desktop/references/References.test.ts` and
`apps/obsidian/src/services/citations/pandoc-export-register.test.ts` cover the
row, the banners and the export notice. Each refusal of the pack is in ZotLit's
log under `pandoc` → `engine`, with its reason.
