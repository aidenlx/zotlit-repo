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
after each edit of the pack file, because Obsidian reports no change for a file
edit. To change the pack file, edit
`.obsidian/plugins/zotlit-resources/main.js` in the vault folder; to restore
it, run the build and open the vault again. The page
`resource-pack-session.md` has the cases in which Obsidian installs, updates
or uninstalls the pack while it runs, and the notice.

| Action | Expected result |
| --- | --- |
| Open **Settings → ZotLit → Zotero** with the pack installed and turned off. | The row says **Ready, from ZotLit Resource Pack** and the pack's version. It has one button, **Open in Community plugins**. |
| Turn the pack on in **Settings → Community plugins**, then open the row. | Obsidian shows no error. The row says the same as with the pack turned off. |
| Uninstall the pack in **Settings → Community plugins**, then open the row. | The row says the ZotLit Resource Pack plugin is not installed, and that until then search splits Chinese titles with built-in rules. |
| Select **Open in Community plugins**. | Obsidian's community plugin browser opens on the page of ZotLit Resource Pack (`obsidian://show-plugin?id=zotlit-resources`). |
| In the pack file, change `"compat":1` on line 1 to `"compat":0`. Open the row. | The row says the installed pack is too old and asks you to update ZotLit Resource Pack. |
| Change the value to `"compat":2`. Open the row. | The row says the installed pack is too new and asks you to update ZotLit. **Open in Community plugins** now opens the page of ZotLit (`obsidian://show-plugin?id=zotlit`). |
| Restore `"compat":1`, then change one letter in the long line near the end of the file. Open the row. | The row says the file of ZotLit Resource Pack is damaged and asks you to uninstall it and install it again. |
| Replace the pack file with the text `module.exports = {};`. Open the row. | The row says the file is damaged, as in the row before. |
| Write a pack whose entry is not a WebAssembly module (command A below). Open the row. | The row says **It did not start:** and the reason the WebAssembly compiler gives, and that until then search splits Chinese titles with built-in rules. |
| Write a pack that has no `chinese-segmenter` entry (command B below). Open the row. | The row says the installed pack is too old and asks you to update ZotLit Resource Pack, as for `"compat":0`. |
| With the pack installed, search the Library View for `流域`. | The results hold `长江流域的城市化研究` (王建国, 2015), the Item `CHNSEG5A` of the group Library **Shared Reading**. |
| With no pack, search the Library View for `流域`, then for `长江流域`. | `流域` finds nothing. `长江流域` finds the Item. |

Run the two commands from `apps/resources`, with the path of the pack file in
the vault as `<pack>`:

```sh
# A: a verified entry that does not start
node -e "Promise.all([import('@zotlit/resource-pack/writer.ts'),import('@zotlit/resource-pack/sha256.ts')]).then(async([w,h])=>{const bytes=new TextEncoder().encode('not wasm');require('fs').writeFileSync(process.argv[1],await w.writePack({entries:[{name:process.argv[2],bytes,sha256:await h.sha256Hex(bytes)}]}))})" <pack> chinese-segmenter
# B: a pack without the Chinese Segmenter entry
node -e "Promise.all([import('@zotlit/resource-pack/writer.ts'),import('@zotlit/resource-pack/sha256.ts')]).then(async([w,h])=>{const bytes=new TextEncoder().encode('not wasm');require('fs').writeFileSync(process.argv[1],await w.writePack({entries:[{name:process.argv[2],bytes,sha256:await h.sha256Hex(bytes)}]}))})" <pack> another-entry
```

The Fixture Spec holds the Item with the Chinese title (`CHNSEG5A` in
`packages/scripts/lib/fixture/spec.ts`). The desktop check covers the search
with the pack, the search with no pack, the row with no pack and its button:
`pnpm e2e --project=desktop src/query-cli.e2e.ts -t Chinese`. The unit suite
`packages/plugin-services/src/obsidian/managed-binary/pack-row.test.ts` covers
the text of each row state. Each refusal of the pack is in ZotLit's log under
`item-lookup` → `segmenter`, with its reason: a warning for each state but "not installed", which is a debug record.
