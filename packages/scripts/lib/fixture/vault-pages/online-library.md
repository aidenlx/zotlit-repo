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

Expected: the first build starts. **Online library** shows "Downloading collections: … of …", then "Downloading items: … of …", then "Saving the downloaded data: … of …", then "Up to date. Last sync: <date and time>." and "Zotero accepted this key for the account <your user name>." `data.json` holds no key and no secret name. **Settings → Keychain** lists the secret.

3. Change the value of the secret in **Settings → Keychain** to an invented key, then select **Sync now**.

Expected: "Zotero did not accept this API key. Check the key, or create a new one. Your notes use the data of the last sync: <date and time>." Search still finds your items.

4. Put the real key back in the secret and select **Sync now**.

Expected: "Up to date. Last sync: <date and time>."

## Sync

1. In Zotero, change the title of an item. In Obsidian, run **ZotLit: Sync Zotero online library**.

Expected: the notices "Syncing Zotero online library…" and "Zotero online library synced." The search finds the item by its new title.

2. Change one more title in Zotero, keep Obsidian in front, and wait 5 minutes.

Expected: the search finds the new title with no action.

3. Change a title, move Obsidian to the background for more than 5 minutes, then bring it to the front.

Expected: no sync runs while Obsidian is in the background. The sync runs when Obsidian has the focus again.

4. Turn off the network and select **Sync now**.

Expected: "ZotLit cannot connect to zotero.org. It tries again at the next sync. Your notes use the data of the last sync: <date and time>."

## Zotero language

1. Open **Zotero language**.

Expected: the first option is "Automatic (<the first language of your system>)", for example "Automatic (British English)" on a system set to English (United Kingdom). The other options are the languages of Zotero by name.

2. In Zotero, set the date of an item to `01/02/2020`. Sync. Select **English (United States)**, then wait for the build.

Expected: **Online library** shows the download again. The item's date reads 2 January 2020 in its literature note.

3. Select **British English** and wait for the build.

Expected: the download runs again, and the date reads 1 February 2020.

## Resource Pack

1. Uninstall ZotLit Resource Pack and reload Obsidian.

Expected: **Online library** says "ZotLit Resource Pack is not installed. Install it from Community plugins. You do not need to turn it on."

2. Install it again.

Expected: the online library starts with no reload, and **Online library** shows "Up to date".

## Remove online library data

1. Select **Remove online library data**.

Expected: a dialog "Remove online library data?" says that the copy of the library leaves this device, that ZotLit stops using the API key, and that the key stays in Obsidian's keychain.

2. Select **Remove**.

Expected: **Online library** says "Select the secret with your Zotero API key to sync your library." The secret control is empty. **Settings → Keychain** still lists the secret. Search finds no item. No request goes to zotero.org until you select a secret again.

## Another account

1. Select a secret with the key of another Zotero account, then select **Sync now**.

Expected: "This API key belongs to another Zotero account. Replace the data on this device to use the new account." **Use the new account** shows with **Replace data**.

2. Select **Replace data**.

Expected: the download of the other account's library starts, and **Use the new account** goes away when it is up to date.
