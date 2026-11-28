---
title: Online library
---
# Online library

Each case uses the **Library source** group at the top of **Settings → ZotLit → Zotero**. The online library reads your library from zotero.org into a copy on this device.

Run state: the default `configured` Fixture Vault, built with `pnpm fixture`, with Obsidian open on it and ZotLit Resource Pack installed (`--install zotlit-resources` after `pnpm --filter @zotlit/resources build:dev`). You need a Zotero API key with read access. In a development build (`pnpm --filter @zotlit/obsidian build:dev`; a release build always uses zotero.org), to use a local fake Zotero API in place of zotero.org, run `app.saveLocalStorage("zotlit-zotero-web-api-url", "<its address>")` in the console before you select the online library; `app.saveLocalStorage("zotlit-zotero-web-api-url", null)` goes back to zotero.org.

## The source is a setting of this device

1. Open **Settings → ZotLit → Zotero**.

Expected: **Library source** shows **Zotero on this computer**, and its description says that the choice is stored on this device only. The Zotero database rows and the **Sync with Zotero** group show as before. No other row of the group shows.

2. Select **Zotero online library**.

Expected: **Reload to apply** shows with **Reload Obsidian**. **Zotero API key**, **Zotero language** and **Remove online library data** show. **Online library** does not show yet. Search and citations still read the Zotero database file.

3. Select **Reload Obsidian**, and open the page again.

Expected: **Reload to apply** is gone. **Online library** says "Select the secret with your Zotero API key to sync your library." The Zotero database rows and the **Sync with Zotero** group are hidden. `data.json` of the plugin holds no source choice.

## The key is a secret of Obsidian's keychain

1. In **Zotero API key**, select **Create a read-only key on zotero.org**.

Expected: the browser opens `https://www.zotero.org/settings/keys/new`.

2. In the secret control of **Zotero API key**, create a secret and paste the key into it.

Expected: the first build starts. **Online library** shows "Downloading items and collections: … so far…" until each library has counted its items, then "Downloading items and collections: … of …", then "Updating your library: … of … Searches wait until the update is done.", then "Up to date. Last sync: <date and time>." and "Zotero accepted this key for the account <your user name>." `data.json` holds no key and no secret name. **Settings → Keychain** lists the secret.

3. Change the value of the secret in **Settings → Keychain** to an invented key, then select **Sync now**.

Expected: "Zotero did not accept this API key. Check the key, or create a new one. Your notes use the data of the last sync: <date and time>." Search still finds your items.

4. Put the real key back in the secret and select **Sync now**.

Expected: "Up to date. Last sync: <date and time>."

## Sync

1. In Zotero, change the title of an item. In Obsidian, run **ZotLit: Sync Zotero online library**.

Expected: the notice "Zotero online library synced." The search finds the item by its new title. A sync that runs longer than 2 seconds also shows the notice "Syncing Zotero online library…" with its progress, and no second notice with the same title.

2. Change one more title in Zotero, keep Obsidian in front, and wait 5 minutes.

Expected: the search finds the new title with no action.

3. Change a title, move Obsidian to the background for more than 5 minutes, then bring it to the front.

Expected: no sync runs while Obsidian is in the background. The sync runs when Obsidian has the focus again.

4. Turn off the network and select **Sync now**.

Expected: "ZotLit cannot connect to zotero.org. It tries again at the next sync. Your notes use the data of the last sync: <date and time>."

## A long sync shows its progress

Use a large library for these cases, or hold the answers of a local fake Zotero API.

1. With an up-to-date library, change the title of one item in Zotero and select **Sync now**.

Expected: the sync ends within 2 seconds, and no notice "Syncing Zotero online library…" shows.

2. Select **Remove online library data**, select **Remove**, then select the secret with your key again.

Expected: after 2 seconds a notice "Syncing Zotero online library…" shows with "Downloading items and collections: … so far…", a bar that moves on its own, and a **Stop sync** button. When each library has counted its items, the line becomes "Downloading items and collections: … of …" and the bar shows the part that is done; the total does not change after that. **Online library** shows the same line. The numbers grow until the download ends. Then the notice shows "Updating your library: … of …" and "Searches wait until the update is done.", with no button. The notice closes when the sync ends.

3. Use a key that reads your personal library and a group. Change nothing in your personal library. In the group, add enough items for a sync longer than 2 seconds, then select **Sync now**.

Expected: the notice shows "Downloading items and collections: … of …" with a bar that shows the part that is done as soon as the group download starts. The personal library counts as 0 and does not hold back the total.

4. Start a search in ZotLit while the notice says "Updating your library".

Expected: the search shows its results after the update ends, from the complete new library.

5. Run a long task, for example **Update all literature notes**, then change a title in Zotero and select **Sync now**.

Expected: when the download ends while the task runs, the notice says "Waiting for a running task to finish…". The update starts after the task ends.

6. Remove the online library data again, select the secret, and select **Stop sync** in the notice during the download.

Expected: the notice closes, and no failure notice shows. **Online library** says "You stopped the sync. ZotLit continues it at the next sync." in normal text. A search says that the online library is not available.

7. Select **Sync now**.

Expected: the download goes on from the items that came in before the stop, so it ends sooner than in step 2. **Online library** shows "Up to date. Last sync: <date and time>." and search finds your items.

8. Remove the online library data again, select the secret, and select **Stop sync** at the moment the download ends.

Expected: the update goes on. The notice shows again at once with no **Stop sync** button, then "Updating your library: … of …". No failure notice shows. The sync ends with "Up to date. Last sync: <date and time>." and search finds your items.

## Export a query

Run each command from the repository root with the Obsidian CLI client, `node packages/scripts/scripts/obsidian-cli.ts vault=<vault name> zotlit:query …`, while the online library is up to date. `<folder>` is an existing folder outside the vault.

1. Run `zotlit:query limit=all output=<folder>/online.json`.

Expected: the answer has `"ok": true` and a `file` with the path, the format `json` and a byte count equal to the size of `<folder>/online.json`, and no rows. The file holds the rows of your library, and `identity.source.kind` is `web-api`. The folder holds no file that ends in `.zotlit-partial`.

2. Run `zotlit:query limit=all format=csv output=<folder>/online.csv`, then select **Zotero on this computer** in **Library source**, reload, and run `zotlit:query limit=all format=csv output=<folder>/local.csv` with the same Zotero data.

Expected: both answers have `"ok": true` and the format `csv`. `online.csv` and `local.csv` hold the same bytes. Select **Zotero online library** again and reload.

3. Run the command of step 1 again.

Expected: `output-error`, and `<folder>/online.json` keeps its content.

4. Run `zotlit:query limit=all output=<folder>/missing/online.json`, then `zotlit:query fields='["notAField"]' output=<folder>/missing/online.json`.

Expected: the first answers `output-error` with the message of the system. The second answers `unknown-field`: the invalid field wins against the missing folder. No file appears.

5. In a development build, run `app.saveLocalStorage("zotlit-online-library-root", "web")` in the console, reload, and run `zotlit:query limit=all format=tsv output=<folder>/web.tsv`.

Expected: the Mobile engine on desktop writes the file too, with `"ok": true` and the format `tsv`. Run `app.saveLocalStorage("zotlit-online-library-root", null)` and reload to go back.

## Zotero language

1. Open **Zotero language**.

Expected: the first option is "Automatic (<the first language of your system>)", for example "Automatic (British English)" on a system set to English (United Kingdom). The other options are the languages of Zotero by name.

2. In Zotero, set the date of an item to `01/02/2020`. Sync. Select **English (United States)**, then wait for the build.

Expected: **Online library** shows the download again. The item's date reads 2 January 2020 in its literature note.

3. Select **British English** and wait for the build.

Expected: the download runs again, and the date reads 1 February 2020.

## Resource Pack

1. Uninstall ZotLit Resource Pack and reload Obsidian.

Expected: on desktop, **Online library** still shows "Up to date" and search finds your items: the desktop keeps the library in a normal SQLite file and needs nothing from the pack.

2. In a development build, run `app.saveLocalStorage("zotlit-online-library-root", "web")` in the console and reload Obsidian. This runs the Mobile engine on desktop.

Expected: **Online library** says "ZotLit Resource Pack is not installed. Install it from Community plugins. You do not need to turn it on."

3. Install it again.

Expected: the online library starts with no reload, and **Online library** shows "Up to date". Run `app.saveLocalStorage("zotlit-online-library-root", null)` and reload to go back to the desktop engine; that engine downloads the library again into its own file.

## Where the library is stored on desktop

1. After the first build, open Obsidian's user-data folder (on macOS `~/Library/Application Support/obsidian`) and the folder `zotlit/<vault ID>` in it. The vault ID is the key of this vault in `obsidian.json` there.

Expected: the folder holds `zotero-replica.sqlite`. The vault folder holds no copy of the library, so a vault sync tool never copies it.

2. While Obsidian runs, open `zotero-replica.sqlite` in another SQLite tool.

Expected: the tool says that the database is locked. Quit Obsidian and open it again in the tool: it opens, with the items of your library.

3. Open a second vault that also uses the online library.

Expected: a second `zotlit/<vault ID>` folder appears for that vault. Each vault searches only its own library.

The status text for a replica file whose checkpoint failed after a good sync has no case here: a tester cannot make that checkpoint fail by hand, so the unit tests of the status text cover it.

## Remove online library data

1. Select **Remove online library data**.

Expected: a dialog "Remove online library data?" says that the copy of the library leaves this device, that ZotLit stops using the API key, and that the key stays in Obsidian's keychain.

2. Select **Remove**.

Expected: **Online library** says "Select the secret with your Zotero API key to sync your library." The secret control is empty. **Settings → Keychain** still lists the secret. Search finds no item. No request goes to zotero.org until you select a secret again. On desktop, the `zotlit/<vault ID>` folder of this vault is gone, with no replica file left, and the folders of other vaults stay as they were. When you select the secret again, the next sync creates the folder again.

## Data of other vaults

The **Online library data** group of **Settings → ZotLit → Advanced** removes the data that vaults leave on this device. It shows also while this vault reads Zotero on this computer.

1. Open **Settings → ZotLit → Advanced**, and select **Remove the data of this vault**.

Expected: the same dialog "Remove online library data?" as on the Zotero page. **Cancel** changes nothing. **Remove** does the same as **Remove online library data**.

Steps 2 to 6 change files in Obsidian's user-data folder, so they run in a disposable Obsidian profile and never in your own. Use a new profile for each run. Quit Obsidian. On macOS, run `P=".scratch/obsidian-cleanup-$(date +%Y%m%d-%H%M%S)"; echo "$P"; open -na Obsidian --args --user-data-dir="$PWD/$P"` from the repository root (on Linux and Windows, start Obsidian with `--user-data-dir` and a new folder in `.scratch/`). Open the Fixture Vault in this Obsidian with **Open folder as vault**, install ZotLit Resource Pack, and select the online library and your key as in the cases above. In steps 2 to 6, `P` is the folder that the command printed, and each step removes only what it creates.

2. Create the folder `P/zotlit/0e2e00000000dead` with a file of about 2.5 MB named `zotero-replica.sqlite`. Create a file of about 10 MB at `P/large.bin`, and in `P/zotlit/0e2e00000000dead` a symbolic link `linked.bin` to it. Also create:
   - `P/zotlit/backups` with a copy of `zotero-replica.sqlite`;
   - `P/zotlit/1e2e00000000beef` with a small file named `notes.txt`;
   - `P/zotlit/3e2e00000000f00d` with a small file named `notes.txt` and a symbolic link `zotero-replica.sqlite` to `P/large.bin`;
   - a symbolic link `P/zotlit/2e2e00000000cafe` to the `zotlit/<vault ID>` folder of this vault.

   Close and open **Settings → ZotLit → Advanced**.

Expected: **Data of other vaults** says that vaults that you removed from Obsidian can leave their online library data on this device. The list shows only `0e2e00000000dead`, with "2.5 MB, last changed" and the date of the file: the linked `large.bin` adds nothing to the size. `backups` (not a vault ID), `1e2e00000000beef` (no replica file), `3e2e00000000f00d` (its replica file is a link), `2e2e00000000cafe` (a link) and the vault IDs of `P/obsidian.json` do not show.

Next to `0e2e00000000dead`, select the delete button. Expected: a dialog "Remove the online library data of 0e2e00000000dead?" says that ZotLit deletes the copy that a removed vault left. **Cancel** keeps the folder. Select the delete button again and **Remove**: the folder goes away, and the list no longer shows it. `P/large.bin`, the library of this vault and the folder that the link points to stay as they were. To finish the step, delete `P/zotlit/backups`, `P/zotlit/1e2e00000000beef`, `P/zotlit/3e2e00000000f00d`, the link `P/zotlit/2e2e00000000cafe` and `P/large.bin`.

3. Create `P/zotlit/0e2e00000000dead/zotero-replica.sqlite` again, and close and open **Settings → ZotLit → Advanced** so that the list shows it. Make a copy of `P/obsidian.json` named `P/obsidian.json.step3`. In `P/obsidian.json`, add `"0e2e00000000dead":{"path":"/tmp/restored","ts":0}` to `vaults`. Then select the delete button next to `0e2e00000000dead` and **Remove**.

Expected: a notice says that ZotLit did not remove 0e2e00000000dead, because a vault of Obsidian can still use it. The folder stays. To finish the step, move `P/obsidian.json.step3` back to `P/obsidian.json` and delete `P/zotlit/0e2e00000000dead`.

4. Make a copy of `P/obsidian.json` named `P/obsidian.json.step4`, replace the content of `P/obsidian.json` with `{"vaults":[]}`, and close and open **Settings → ZotLit → Advanced**.

Expected: **Data of other vaults** says in a warning color that ZotLit could not read the list of vaults of Obsidian, so it shows no folder to remove. The list shows no folder and has no delete button. The ZotLit log holds the reason. To finish the step, move `P/obsidian.json.step4` back to `P/obsidian.json`.

5. In a development build, run `app.saveLocalStorage("zotlit-online-library-root", "web")` in the console of the Fixture Vault, and reload it. This runs the Mobile engine on desktop. In the same Obsidian, create a second vault in `P/second-vault` with **Create new vault**. Copy the folders `.obsidian/plugins/zotlit` and `.obsidian/plugins/zotlit-resources` of the Fixture Vault into `P/second-vault/.obsidian/plugins/`, then in the second vault turn on community plugins and turn on ZotLit and ZotLit Resource Pack. Run `app.saveLocalStorage("zotlit-online-library-root", "web")` in the console of the second vault and reload it. Select the online library with the same key, wait until it is up to date, and close that vault's window. Open **Settings → ZotLit → Advanced** in the Fixture Vault.

Expected: **Data of other vaults** warns that a vault on this device that still uses a folder downloads its online library again at its next sync. The list shows the pool folder of the second vault with the size of its pool files and their newest change, and no other folder of ZotLit such as `language-pack`. The dialog of its delete button says the same warning, and that the vault keeps its Zotero API key. After **Remove**, open the second vault: it downloads its library again at its next sync, with no new question about the account.

6. Run `app.saveLocalStorage("zotlit-online-library-root", null)` in the console of the Fixture Vault and reload it to go back to the desktop engine.

Expected: the online library works as before. The disposable profile stays in `.scratch/`, which git ignores; the next run uses a new one.

## Another account

1. Select a secret with the key of another Zotero account, then select **Sync now**.

Expected: "This API key belongs to another Zotero account. Replace the data on this device to use the new account." **Use the new account** shows with **Replace data**.

2. Select **Replace data**.

Expected: the download of the other account's library starts, and **Use the new account** goes away when it is up to date.
