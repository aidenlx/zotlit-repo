---
status: accepted
---

# Managed Binaries ship in the Resource Pack, a third plugin that ZotLit reads without loading

Revises the Managed Binary parts of [ADR 0069](0069-the-item-search-index-runs-in-the-zoteroreads-worker.md) and the "disabled companion pack" option of [ADR 0098](0098-zotlit-and-zotlit-reader-cooperate-through-a-versioned-workspace-handshake.md).

## Context

ZotLit depends on two WASM binaries, the Pandoc Engine (58.6 MB) and the Chinese Segmenter (4.0 MB). Since ADR 0069 both were Managed Binaries that ZotLit downloaded at run time from a third-party release, with the user's consent, into one device-wide OPFS store.

Three facts ended that design:

- Obsidian's policy for community plugins does not permit a plugin to download executable code at run time.
- The binaries cannot go into ZotLit's bundle. Each MB of inert string in `main.js` costs every cold start of the plugin, for every user (table below). The Pandoc Engine alone puts ZotLit over both start-up budgets of [ADR 0099](0099-the-start-up-gate-measures-obsidian-s-own-cold-start-number-per-plugin.md).
- The old store does not carry over to mobile: its OPFS write call works on desktop only.

Obsidian 1.15.1 downloads a plugin's `main.js` as text, removes inline source-map lines, appends text at its end, writes it as a UTF-8 string, and checks every installed plugin for updates, enabled or not. So a plugin that is installed and not enabled costs nothing at start-up and still gets updates.

## Decision

- **A third published plugin carries the binaries.** The Resource Pack (ZotLit Resource Pack, plugin id `zotlit-resources`, `apps/resources`) is installed from Obsidian's community plugin browser. It needs no enabling; when enabled, it loads as a plugin class that adds nothing.
- **Its `main.js` is a text container.** Line 1 is a fixed-size index (4,096 bytes, a comment that holds JSON): one compatibility integer and, for each Pack Entry, its name, byte offset, byte length and the SHA-256 of the entry text. Then the plugin class, then one block comment with one line per Pack Entry: the binary as gzip, then base64. Offsets count from the start of the file, because Obsidian appends at the end. Base64 has no character that ends the comment or matches Obsidian's source-map removal.
- **One reader for every host.** `@zotlit/resource-pack` is free of Node, Electron and Obsidian. It takes one capability, "read `length` bytes at `offset` of the pack file", and on each read does: index, compatibility integer, entry text, SHA-256, base64, gunzip. Its failures are typed: pack absent, pack too old, pack too new, entry missing, entry damaged, pack unreadable.
- **One read capability over `fetch` with a `Range` header.** The hosts answer in four ways, and `fetchRange` gives the same bytes from each: 206 with the range; 206 with the correct start and a body that runs to the end of the file (Android); 200 with the range as its body (desktop Obsidian); 200 with the full file (iOS). Desktop Obsidian rejects the `fetch` of a missing file, so the desktop host learns "absent" from Obsidian's installed plugins.
- **Decoding stays on the host's own decoders.** Base64 goes through `fetch` of a `data:` URL, gzip through `DecompressionStream`. The reader does not call `Uint8Array.fromBase64`: on WebView 124 it is a polyfill on the main thread (86 ms against 24 ms for the Chinese Segmenter) and absent in a Worker.
- **No cache.** ZotLit reads the pack when a feature first asks for an engine, when the settings row is shown, and after Obsidian reports a change of the installed plugins. A pack that is installed, updated or removed during the session is seen with no restart.
- **The Managed Binary service keeps its role and loses the download.** One declaration per binary, one status (`pack-absent`, `pack-outdated`, `plugin-outdated`, `pack-damaged`, `ready`, `failed`), one settings row whose action opens the plugin to install or update in the community plugin browser, and one notice per vault per state. The download, the consent record, the device-wide OPFS store and the uninstall action are gone. The ZoteroReads worker reads and verifies the Chinese Segmenter entry itself, from the pack file's location.
- **One-time cleanup.** On the first start after the update, ZotLit removes the old device-wide binary folder and the old consent records.
- **Own version line, one compatibility integer.** The pack releases from the same pipeline as the other plugins, to its own publish repository. The integer changes only when the container format or the meaning of an entry changes. The bundle check holds the pack to a size budget (25,800,000 B), valid JavaScript, and a round trip of each real entry through Obsidian's install-time text changes, against its pin.
- **What stays where it is.** Language Packs and schemas stay on the Resource Release. pdf.js stays in ZotLit Reader's bundle. ZotLit's two workers stay in ZotLit's bundle.

## Considered Options

- **Keep the run-time download.** Rejected: Obsidian's policy does not permit it, and the store has no mobile write path.
- **The binaries in ZotLit's `main.js`.** Rejected: +3.7 MB and +21.3 MB of string cost 32 ms and 142 ms on each iPhone cold start, and on desktop the Pandoc Engine alone gives 176.7 ms against a base of 117.3 ms, over the budgets, for users who never export.
- **A binary file beside the pack's `main.js`.** Rejected: Obsidian's installer downloads only `main.js`, `manifest.json` and `styles.css`.
- **A raw binary or a non-text encoding in `main.js`.** Rejected: Obsidian reads and writes the file as UTF-8 text.
- **An index at the end of the file (the footer of the ZotFlow Enhancement Pack).** Rejected: Obsidian appends text after it. The index is first, with offsets from the start.
- **An OPFS or IndexedDB copy of each entry after the first read.** Rejected: it saves approximately 45 ms (Segmenter) and 200 ms (Pandoc) that no user waits for at start-up, and costs a second copy, an invalidation rule and a write path that differs on mobile.
- **A host-specific reader (Node `fs` on desktop).** Not needed: the `fetch` capability reads correctly on the desktop main thread and in the ZoteroReads worker.
- **pdf.js in the pack.** Rejected: 7 ms of 91 ms on an iPhone cold start, and ZotLit Reader could open no PDF without the pack.
- **One pack per binary.** Deferred: one install is simpler for the user. If the 25 MB size causes a reported problem, the Pandoc Engine moves to its own pack.
- **A one-click install through Obsidian's private plugin installer.** Rejected: it is not a public API.

## Consequences

- A user who wants formatted references, the built-in export or the Chinese Segmenter installs a second plugin. Without it ZotLit works as before without the binaries, and the settings row and one notice name the plugin to install.
- A user who had a binary installed sees `pack-absent` after the update, until the pack is installed.
- The pack is per vault, where the old store was per device.
- A sync tool or a line-ending change in git can change the pack file. The per-entry hash turns each such case into `pack-damaged`; a reinstall corrects it.
- On iOS each read gets the full 25 MB file, because the host ignores the `Range` header.
- `applyObsidianInstall` in `@zotlit/resource-pack` copies the install-time text changes of Obsidian 1.15.1. A later Obsidian version can change them; read them again from the extracted `app.js`.
- The session-follow rule depends on Obsidian replacing the pack's manifest object on install, update and uninstall (1.15.1). The settings row reads the pack each time it is shown, whatever a later version does.
- The pack redistributes Pandoc (GPL-2.0-or-later) and jieba-wasm (MIT) and carries their licence texts and source links.

## Measurements

Before the decision (spec [#42](https://github.com/aidenlx/zotlit-repo/issues/42)), 2026-11-21, Obsidian 1.15.1:

| Measure                                                   | iPhone SE, iOS 18.6            | Android 15 emulator, WebView 124 | Desktop                              |
| --------------------------------------------------------- | ------------------------------ | -------------------------------- | ------------------------------------ |
| Cost of 1 MB of inert string in `main.js`, per cold start | 7 to 9 ms                      | 9 to 10 ms                       | 2.5 ms daily, 4 ms after an update   |
| Reader start, asset strings inline / removed              | 91 / 84 ms                     | 158 / 156 ms                     | 23.7 / 22.2 ms                       |
| Host plugin start with +3.7 MB / +21.3 MB                 | 116 / 226 ms (base 84)         | 189 / 372 ms (base 156)          | ZotLit 125.9 / 176.7 ms (base 117.3) |
| `fetch` of the pack file with `Range`                     | 200, full body, header ignored | 206, start honoured, end ignored | not measured                         |
| Pack direct read, Chinese Segmenter                       | 54 ms                          | 55 ms                            | 5.6 ms (Node)                        |
| Pack direct read, Pandoc Engine                           | 235 ms                         | 345 ms                           | 79 ms (Node)                         |
| OPFS read, Segmenter / Pandoc                             | 3 / 21 ms                      | 13 / 163 ms                      | not measured                         |

The emulator runs on a software GPU: its numbers compare variants, not devices.

After the build:

**Desktop `Range` answer** (ticket #43; Obsidian 1.15.1, Chrome 150, Electron 43.8.9; `app.vault.adapter.getResourcePath` URL). Status 200 for each request, with no `Content-Range` and no `Content-Length`; the body is the requested range (`bytes=0-4095` gives 4,096 B). A missing file rejects the `fetch`. The Chinese Segmenter entry read back as its pin (4,015,140 B) on the main thread in 23 ms, in a new Blob-URL worker in 14.4 ms, and in the live ZoteroReads worker in 26.4 ms. A full read and check of the Pandoc Engine entry takes approximately 80 ms.

**Pack size** (ticket #45; gzip level 9 of Node's zlib):

| Part                                 | Raw          | In the pack (entry text)           |
| ------------------------------------ | ------------ | ---------------------------------- |
| Pandoc Engine (Pandoc 3.10)          | 58,580,800 B | 21,697,672 B                       |
| Chinese Segmenter (jieba-wasm 2.4.0) | 4,015,140 B  | 3,764,432 B                        |
| `main.js`                            |              | 25,488,209 B (budget 25,800,000 B) |

With the pack, ZotLit's own `main.js` is 4,959,834 B (budget 5,000,000 B), and its start-up medians are 111.1 ms daily (budget 145 ms) and 155.8 ms after an update (budget 190 ms).

**Device reads** (ticket #49; the product `readPackEntry(fetchRange(url), name)` from the installed pack, not enabled; median of 3 runs, in ms):

| Entry             | Thread          | iPhone SE, iOS 18.6 (200, full file) | Android 15 emulator, WebView 124 (206 to the end of the file) |
| ----------------- | --------------- | ------------------------------------ | ------------------------------------------------------------- |
| Chinese Segmenter | main            | 84                                   | 94                                                            |
| Chinese Segmenter | Blob-URL Worker | 81                                   | 101                                                           |
| Pandoc Engine     | main            | 349                                  | 452                                                           |
| Pandoc Engine     | Blob-URL Worker | 351                                  | 592                                                           |

Steps of the Pandoc Engine read on the main thread, iPhone / emulator: read 44 / 153 ms, hash 22 / 16 ms, base64 203 / 189 ms, gunzip 116 / 149 ms. In the emulator's Worker the base64 step takes 399 ms. Each entry gave the hash of its pin on both devices and both threads. Both hosts answer with `Cache-Control: no-cache`: after the pack file was replaced three times under one URL, each read gave the bytes on disk, so the read needs no `cache: "no-store"` and no query string. `Uint8Array.fromBase64` is native on iOS 18.6; on WebView 124 it is a polyfill on the main thread and absent in a Worker.

<!-- ===================================================================== -->
