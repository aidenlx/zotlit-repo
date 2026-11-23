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
- **The Managed Binary service keeps its role and loses the download.** One declaration per binary, one status (`pack-absent`, `pack-outdated`, `plugin-outdated`, `pack-damaged`, `ready`, `failed`), one settings row whose action opens the plugin to install or update in the community plugin browser, and one notice per vault per state. The download, the consent record, the device-wide OPFS store and the uninstall action are gone. The ZoteroReads worker reads and verifies the Chinese Segmenter entry itself, from the pack file's location, and states the Segmenter's status: the renderer locates the pack and shows what the worker answers ([#144](https://github.com/aidenlx/zotlit-repo/issues/144)).
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

The source release workflow plans and verifies the Resource Pack with the other products. It publishes to `aidenlx/zotlit-resources`, copies the generated container's `main.js` byte for byte, then records the source tag as `resources-<version>`.

### Container implementation and checks

Build the Pack Entry pins from the app manifest and use the same pins for the package build and bundle check. Read the Chinese Segmenter from the web build of `jieba-wasm` because the runtime uses that package's web glue. Read the Pandoc version from the installed `pandoc-wasm` metadata. Include the upstream license and source link for both binaries, including the pinned Pandoc COPYING file. The production build writes a bundle package and identical `main.js` bytes in `dist/`. The development build installs into the selected Development Vault. The production build spends extra time on maximum gzip compression because every installation downloads those bytes.

Use the index's final byte for the line feed. The parser reads the JSON up to the closing delimiter so a CRLF conversion still allows index parsing. The offset and entry hash detect the resulting shifted bytes. Keep the index offsets absolute and keep the index, entry and notice comment text intact in every generated copy. Encode Base64 in chunks that are multiples of three bytes so the concatenation contains padding only at the end. The host-free writer accepts an injected gzip implementation, so the app can use Node zlib and browser tests can use `CompressionStream`.

A range reader accepts a short result at end of file and reports an absent pack separately from other read failures. For HTTP 206, read enough of the response to cover the requested length and cancel the rest. For HTTP 200, a body no longer than the request is the desktop range reply. A longer body is the full file, so discard the prefix up to the requested offset. Send a Pack Entry location to the Worker with the pack manifest version and the last verified entry-text hash. Use a null hash before a successful read and after a failed read.

Run the same round-trip cases in Node and the Electron renderer. Generate an incompressible entry large enough to exercise multiple reads. Cover the Android, iOS, and desktop range responses, the Obsidian install transform, and the CommonJS plugin export. Use the real WebAssembly compression fixture to check that the selected gzip level reduces download size.

The bundle gate compiles the Resource Pack script without executing it, then applies Obsidian's install transform and reads each pinned entry back.

The source and publish builds call the same copy operation on the Resource Pack bundle. The test exercises comments, CRLF bytes, an inline source-map line, and the absence of a trailing line feed. All bytes have to survive the shell copy because the index counts byte offsets.

The bundle gate reads declared Pack Entry pins and measures only main.js
for a Resource Pack. In the Fixture, keep the pack installed and absent
from the enabled plugin list.

Keep the pack installed and disabled in the End-to-end Run, as the
community browser leaves it. Save its manifest and preserve its
original file when a case replaces it. Restore it through the same
manifest reload and change notification as a plugin install. Clear
recorded notices and wait for the Chinese Segmenter to read the
restored pack. The migration case seeds the previously downloaded
files and dismissed offers, restarts with no record of cleanup or
pack notices, and checks the surviving state. Fixture teardown
removes the seeded files and records completed cleanup.
[Resource Pack cases](../../packages/e2e/src/resource-pack.ts)

The desktop cases distinguish pack state by changing the installed
manifest and publishing an install event. Test an unreadable compatibility
version by changing the first-line index. Test damaged data by changing
a valid base64 character in the Segmenter entry. The two Managed
Binaries share this pack. An inner word of the Fixture's Chinese title
matches only with the pack segmenter, while the fallback can match the
whole word. Verify one notice per state even across repeated demands,
the action for the plugin the reader must install or update, and a
retry when the same version is repaired. A ready pack shows no notice.
After upgrade from downloaded binaries, wait for the new search to
observe the first missing-pack notice. Later starts leave the device
alone after recorded cleanup. In Preview, installation during a session
makes the engine available on the next read.

### Managed Binary status, ownership, and presentation

Use a descriptor per binary and give each its own Effect service and Scope.
The Pack Entry uses the descriptor's ID. Report read refusals as values.
An absent pack describes the preinstall state. An older pack or missing
entry requires a pack update, a newer pack requires a plugin update, and
damaged data requires a reinstall. Preserve the initiating failure cause
and its message when start or release fails. An optional start probe
reports invalid runtime bytes before the first borrow.

A status read checks disk again. Concurrent callers join one read owned
by the layer, so canceling a reader leaves the other callers served.
Keep a failed start associated with the entry's SHA-256. Leave it failed
until the bytes change or an explicit start succeeds. A cached status
does not read the file, and an unread installed pack has no status yet.
Publish missing-pack observations and emit distinct changes. On a new
installation, update, or removal, retire the old shared engine and read
again for watchers. The first borrower starts the engine and gives the
caller a scoped lease. A lease survives a pack change. The shared
engine remains after its last borrower until retired or the layer
closes. Let the common start finish before handling borrower cancellation.

The renderer tests that the Chinese Segmenter compiles without keeping
an instance. The Worker verifies and instantiates the entry independently
through the same origin URL. Publish the entry digest with a verified
location so changes and repairs give the Worker a new identity. Strip
the time component Obsidian appends to out-of-index resource URLs.
Only a different installed manifest triggers reread, since enable and
disable also raise plugin change reports. Treat an installed but disabled
pack as available.

Each settings row reads on mount and observes later status. Show the
license and source with the binary's description, and explain fallback
when the binary is unavailable. Route the recovery button to the plugin
that can resolve the status. Features can continue while recording and
displaying a notice. Deduplicate by pack state per vault across binaries.
A Chinese search can request the Segmenter asynchronously and continue
with platform word segmentation.

Old-store keys live in host-free code so the desktop tests use the same
names. Remove downloaded directories from origin-private storage and
remove each vault's old offer records. An absent entry succeeds. Remove
the parent only when empty. Record completion per vault, even when
another vault already removed shared files. Log failures and try again
next start. Startup does not wait for this cleanup.

Test file replacement separately from Obsidian's change announcement.
An entry verification reads the index before the entry. Exercise a
damaged pack, a same-version repair, and re-damage. Simulate a locked
file and require recursive removal for nonempty directories. Use a
minimal valid WebAssembly module for platform tests and the shipped web
binary when testing the real Segmenter.
[Managed Binary service](../../packages/plugin-services/src/obsidian/managed-binary/pack-binary.ts) ·
[Pack platform](../../packages/plugin-services/src/obsidian/managed-binary/pack-platform.ts)

Pandoc formatting and export request the unread engine on first use.
A known missing pack needs no read. The render can answer without
formatting and show a deduplicated recovery notice. Hold the render
until the engine comes or goes. The first read of already-requested
bytes only confirms availability. The tests load the actual binary
beside the Node entry point of the Pandoc WASM dev dependency.

The web glue's default loader would inline the Segmenter WASM into
the plugin library build. Mark that asset URL so Vite leaves it
alone. The actual startup uses initSync with verified Pack Entry bytes.
The renderer passes the installed location to ZoteroReads without
reading it during worker startup. The Worker verifies the entry
and reports the digest, including after a same-version reinstall.
An installed but unread Pandoc pack has no status. The first borrow
can report damage and a subsequent status wakes render subscribers.

The host's plugin change event also covers enable and disable. An install
or update replaces the manifest object, so the observer can distinguish
these cases by identity.

ZoteroReads configuration sends the installed Segmenter location and
the verified hash when known. The Worker reads the entry independently.
An absent binary reader treats an entry as unavailable. Tests inject
the web-target binary through that reader port.

## Status ownership and tests

The worker reads the installed Segmenter entry and reports the binary that actually cuts text. The renderer locates the pack and reads the worker's status again after ZoteroReads recovers, including when no pack is installed. A refused location can be tried again. After a successful `jieba-wasm` start, the JavaScript realm keeps that instance through pack replacement and removal until it restarts. Status names the version whose bytes are active. The fallback segments with `Intl.Segmenter`; the service tests distinguish it using the compound `长江流域` and the substring `流域`.

A status check joins a read already in progress. The read belongs to the service Scope, so cancellation of a waiter leaves the remaining waiters served. An installed pack is unread until the check completes. A verified binary that failed to start stays failed until bytes change or an engine start succeeds. The first borrower starts the shared engine, the borrowing Scope controls its lease, and a refusal includes the status from that read so callers need no second lookup. Release failures go to logs. A missing Pack Entry in a compatible file is reported as older pack content. The ZoteroReads contract owns the wire Schema for the status types.

## Amendment (2026-11-23): the Chinese Segmenter entry records its jieba-wasm version

The Resources build writes `upstreamVersion`, the jieba-wasm version of the pin, into the index entry of each Pack Entry. ZotLit compares the version of the `chinese-segmenter` entry with the jieba-wasm glue that it bundles (`JIEBA_WASM_VERSION`) before it compiles the binary or calls `initSync`. An older entry gives `pack-outdated` and a newer entry gives `plugin-outdated`, so the settings row, the notice and the update button work with no new status or message. The Segmenter then uses `Intl.Segmenter`. A refused entry never reaches `initSync`, so it cannot leave a broken instance in the realm for a later valid pack. A known-mismatched pack that arrives after a working one is also refused.

Accepted limits:

- A pack without the field counts as jieba-wasm 2.4.0 (`LEGACY_PACK_JIEBA_VERSION`). The only released pack, `resources-1.0.0-beta.0`, has no field, and the SHA-256 of its `chinese-segmenter` entry equals the jieba-wasm 2.4.0 binary. This constant stays 2.4.0 when jieba-wasm is upgraded.
- The field is additive, so the compatibility integer stays 1. Readers that do not know the field ignore it.
- A mismatch shows the "too old" or "too new" sentence of the existing statuses, not a sentence that names a version mismatch.

Rejected:

- **A check of the module's exports before `initSync`:** about 25 lines that compare the exports with a hard-coded list of names, and the list must follow each jieba-wasm upgrade.
- **A release rule that changes the compatibility integer at each jieba-wasm upgrade:** no code holds the rule, and a forgotten change lets a mismatched binary reach the Segmenter.

The maintainer chose "pin the jieba version" on 2026-11-23. [Issue 57](https://github.com/aidenlx/zotlit-repo/issues/57) · [PR 239](https://github.com/aidenlx/zotlit-repo/pull/239) (`fbab6f637`, `3245bdc64`)
