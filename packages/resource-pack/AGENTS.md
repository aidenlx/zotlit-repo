# @zotlit/resource-pack

The Resource Pack container: the text format of the pack's `main.js`, the writer that the pack build runs (`apps/resources`), and the reader that every host loads.

The package is host-free: web APIs only, with no Node built-in, `obsidian` or `electron` (`engineBoundaryRules`). The plugin's main thread, a Web Worker and a phone load the same reader.

The package has no dependency (`dependencies` in its `package.json` is absent), so the reader stays standalone: a host loads it with no other package. Keep each type here a plain TypeScript type, and put a Schema of one in the package that sends it.

## Files

- `src/format.ts` — the container: `PACK_COMPAT` (the compatibility integer), the index line (`PACK_INDEX_BYTES` bytes on line 1, a comment that holds JSON: `compat`, and each entry's `name`, `offset`, `length`, `sha256` and optional `upstreamVersion`), and `PackFailure`. Each offset counts bytes from the start of the file, because Obsidian appends text at the end of `main.js` on install.
- `src/writer.ts` — `writePack`: the index, a plugin class that adds nothing to `Plugin`, an optional notice comment, and one block comment with one line per Pack Entry (the binary as gzip, then base64). It refuses bytes that differ from the entry's pin. It compresses with `CompressionStream`; a caller gives a stronger compressor as `gzip`.
- `src/reader.ts` — `readPackEntry(read, name)`: reads the index, compares the compatibility integer, reads the entry text, checks its SHA-256, and decodes base64 and gzip. `ReadRange` is the one capability it takes: `length` bytes at `offset` of the pack file. Every call reads the file again; the reader keeps no cache. A failure is a `PackFailure` value: `pack-absent`, `pack-outdated`, `plugin-outdated`, `entry-missing`, `entry-damaged`, `pack-unreadable`.
- `src/status.ts` — the types `PackBinaryStatus` and `PackBinaryRefusal`: where a binary of the pack stands for the plugin that reads it (`pack-absent`, `pack-outdated`, `plugin-outdated`, `pack-damaged`, `failed`, `ready`). `refusalStatus` gives the status of a `PackFailure`. The Schema of both types is in the ZoteroReads contract (`packages/zotero-reads/src/contract/rpc.ts`), where the status crosses the wire, with a type check that holds it equal to these types.
- `src/fetch-range.ts` — `fetchRange(url, { fetch? })`: the default `ReadRange`, `fetch` with a `Range` header. It gives the same bytes from a 206 answer with the range, a 206 answer that runs to the end of the file (Android), a 200 answer with the range as its body (desktop Obsidian), and a 200 answer with the full file (iOS). A 404 answer is `PackAbsentError`. Desktop Obsidian rejects the `fetch` of a missing file, which the reader reports as `pack-unreadable`: a desktop host learns that the pack is absent from Obsidian's installed plugins.
- `src/pins.ts` — `PackPins` and `parsePackPins`: the pins that the pack app's package.json states under `packEntries`. The pack build and `pnpm check:bundle` both read them through it.
- `src/sha256.ts` — `sha256Hex`, the one hash of the writer, the reader and the cases.
- `src/obsidian-install.ts` — `applyObsidianInstall`: the text changes Obsidian 1.15.1 makes to a downloaded `main.js`. The tests and `pnpm check:bundle` apply it before they read a pack back.

## Decoding

The reader decodes base64 through `fetch` of a `data:` URL, the host's own decoder, and gunzips with `DecompressionStream`. `Uint8Array.fromBase64` is a slow polyfill on WebView 124 and absent in its Worker. Keep the reader inside that API floor.

## Tests

`src/container.browser-test.ts` holds the Pack container cases, each with its expected outcome. `src/container.test.ts` runs them in Node (`pnpm exec vitest run`), and `apps/resources/scripts/container.electron.test.ts` runs the same cases in an Electron renderer, on its `fetch`, `crypto.subtle` and `DecompressionStream`. Add a case to the list and both suites run it.
