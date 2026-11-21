---
title: Resource Pack installed, updated and uninstalled while Obsidian runs
---
# Resource Pack installed, updated and uninstalled while Obsidian runs

Use this page in the Fixture Vault (`docs/fixture.md` → **Use the Fixture
Vault**), opened with `--install zotlit-resources` after
`pnpm --filter @zotlit/resources build:dev`. Do every step in one session:
no step needs a restart of Obsidian.

Choice models are estimated in [@Hensher2011].

ZotLit reads the pack again when Obsidian reports that it installed, updated
or uninstalled the pack. An edit of the pack file in the vault folder raises
no report. To make Obsidian report an edited file as an update, run this in
the developer console after the edit:

```js
await app.plugins.loadManifest(app.plugins.manifests["zotlit-resources"].dir);
app.plugins.didChange();
```

These are the two steps that end Obsidian's own install of a plugin. To start
the notice cases again in a vault that showed them, run
`app.saveLocalStorage("zotlit-resource-pack-notices", null)` in the console.

## The status follows the pack

Keep the **References** Sidebar open on this page, and keep **Settings →
ZotLit → Zotero** open for the **Chinese segmenter** row.

| Action | Expected result |
| --- | --- |
| With the pack installed, read the row and the **References** Sidebar. | The row says **Ready, from ZotLit Resource Pack** and the version. The Sidebar holds the formatted reference of Hensher 2011, with no banner. |
| Uninstall ZotLit Resource Pack in **Settings → Community plugins**. Open the Zotero page again. | The row says ZotLit Resource Pack is not installed. The Sidebar shows the plain list and the banner **Format these references**. A search for `流域` in the Library View finds nothing. |
| Put the built pack folder back in `.obsidian/plugins/` and select **Reload plugins** in **Settings → Community plugins** (or install the pack from the community plugin browser when it is listed there). | The row says **Ready** again. The banner goes and the reference is formatted. A search for `流域` finds `长江流域的城市化研究`. |
| With the row open, change `"compat":1` on line 1 of the pack file to `"compat":2`, and run the console lines. | The open row changes to "too new", and asks you to update ZotLit. Its button opens the page of ZotLit. The Sidebar shows the warning banner **The Pandoc engine is unavailable** with the same sentence. |
| Change the value to `"compat":0` and run the console lines. | The open row changes to "too old", and asks you to update ZotLit Resource Pack. Its button opens the page of ZotLit Resource Pack. |
| Restore `"compat":1`, change one letter in the last long line of the file, and run the console lines. | The **Pandoc engine** row on the Citations page says the file is damaged. The **Chinese segmenter** row stays **Ready**: its entry is the long line before. |
| With the file restored, change the first letter of the long line of the `chinese-segmenter` entry (the long line before the last one), and run the console lines. Search the Library View for `流域`. | The **Chinese segmenter** row says the file is damaged. `流域` finds nothing. |
| Restore that letter and run the console lines: the same version, repaired. Search for `流域`. | The row says **Ready**. `流域` finds `长江流域的城市化研究`, with no restart. |
| Restore the file (run the build and the console lines). Run **ZotLit: Export note with citations** as HTML. | Both rows say **Ready**. The export completes: the engine started from the restored pack. |
| Turn another community plugin off and on. | The rows, the Sidebar and the search stay as they are. |
| Edit the pack file to `"compat":2` and do not run the console lines. | The open rows keep their status. Close and open the settings page: the row then shows "too new". |

## The notice

The notice has the title **ZotLit cannot use the Pandoc engine and the Chinese
segmenter.**, the sentence of the pack's state, and the button **Open in
Community plugins**. It stays until you close it. It shows when a feature
needs a binary that the pack does not give: a render of citations or
references (this page in reading view, the **References** Sidebar, a Template
Workbench preview) or a search of Chinese text.

| Action | Expected result |
| --- | --- |
| Clear the notice record (console line above). With no pack, open this page with the **References** Sidebar. | One notice says that ZotLit Resource Pack is not installed. Its button opens the page of ZotLit Resource Pack. |
| Close the notice. Search the Library View for `流域`, open another note with citations, and restart Obsidian. | No second notice for this state, in this session or the next one. |
| Start Obsidian with no pack and with no note open, and do not search. | No notice. |
| With no pack, run **ZotLit: Export note with citations**. | The export shows its own notice each time. It adds no second notice. |
| Clear the record. With no pack and with all panes closed, search the Library View for `Hensher`, then for `流域`. | `Hensher` shows no notice. `流域` shows the notice once. |
| Make the pack "too new" (above). Search for `流域`, or open the **References** Sidebar. | One new notice says that the pack is too new and asks you to update ZotLit. Its button opens the page of ZotLit (`obsidian://show-plugin?id=zotlit`). |
| Make the pack "too old", then damaged, each time followed by a search for `流域` or a render. | One new notice for each state, with the sentence of that state. Each button opens the page of ZotLit Resource Pack. |
| With the pack ready, or with a pack whose binary does not start (command A on `resource-pack-chinese-segmenter.md`), search for `流域`. | No notice. The row gives the reason for a binary that does not start. |

The desktop check `pnpm e2e --project=desktop src/query-cli.e2e.ts -t 'during the session'`
runs the update to a pack that is too new, the uninstall, the install of a
damaged pack and its repair with the same version, with the row open, the row's button for ZotLit's page, the search of Chinese text
in each state, and one notice for each state. The unit suites
`pack-binary.test.ts`, `pack-notice.test.ts` and `pack-row.test.ts` in
`packages/plugin-services/src/obsidian/managed-binary/`,
`packages/plugin-services/src/obsidian/item-lookup/service.test.ts` and
`apps/obsidian/src/services/citations/render-cache.test.ts` cover each state.
