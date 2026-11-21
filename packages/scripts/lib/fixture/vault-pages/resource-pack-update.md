---
title: First start after the update from a version that downloaded the binaries
---
# First start after the update from a version that downloaded the binaries

Use this page in the Fixture Vault (`docs/fixture.md` → **Use the Fixture
Vault**). Each case restarts ZotLit: turn it off and on in **Settings →
Community plugins**, or restart Obsidian.

Versions before the ZotLit Resource Pack downloaded the Pandoc engine and the
Chinese segmenter to a folder that every vault of the device shares, and
recorded a dismissed install offer in the vault. ZotLit removes both on its
first start after the update, and records in the vault that it did.

To make the device and the vault look as such a version left them, run this
in the developer console:

```js
const store = await (await navigator.storage.getDirectory()).getDirectoryHandle("zotlit", { create: true });
for (const name of ["chinese-segmenter", "pandoc-engine"]) {
  const file = await (await store.getDirectoryHandle(name, { create: true })).getFileHandle("old.wasm", { create: true });
  const writable = await file.createWritable();
  await writable.write("old binary");
  await writable.close();
  app.saveLocalStorage(`zotlit-${name}-declined`, true);
}
app.saveLocalStorage("zotlit-binary-download-removed", null);
```

To read what the device and the vault hold, run:

```js
const names = [];
try {
  for await (const name of (await (await navigator.storage.getDirectory()).getDirectoryHandle("zotlit")).keys()) names.push(name);
} catch (error) {
  names.push(error.name);
}
console.log(names, app.loadLocalStorage("zotlit-chinese-segmenter-declined"), app.loadLocalStorage("zotlit-pandoc-engine-declined"), app.loadLocalStorage("zotlit-binary-download-removed"));
```

| Action | Expected result |
| --- | --- |
| Run the first block, then the second. | The second block prints `["chinese-segmenter", "pandoc-engine"]`, `true`, `true`, `null`. |
| Restart ZotLit. Run the second block. | It prints `["NotFoundError"]`, `null`, `null`, `true`: the folder and both records are gone, and the vault records the cleanup. |
| With no ZotLit Resource Pack installed, open the page `resource-pack-session.md` with the **References** Sidebar after that restart. | The Sidebar shows the plain list and the banner **Format these references**. One notice says that ZotLit Resource Pack is not installed. The **Pandoc engine** and **Chinese segmenter** rows say the same, each with the one button **Open in Community plugins**. No row offers a download. |
| Install ZotLit Resource Pack. | The rows say **Ready**, and the reference is formatted. |
| Run the first block without its last line, and restart ZotLit. Run the second block. | It prints `["chinese-segmenter", "pandoc-engine"]`, `true`, `true`, `true`: the cleanup ran one time for this vault and does not run again. |
| Run the first block with one more line before the last one, `await store.getDirectoryHandle("other", { create: true });`, and restart ZotLit. Run the second block. | It prints `["other"]`, `null`, `null`, `true`: the two binary folders are gone, and the folder stays with what ZotLit did not put there. |

After the cases, remove the folder with
`await (await navigator.storage.getDirectory()).removeEntry("zotlit", { recursive: true })`.

The desktop check `pnpm e2e --project=desktop src/query-cli.e2e.ts -t 'first start after the update'`
runs the first, second, third and fifth rows. The unit suite
`packages/plugin-services/src/obsidian/managed-binary/old-store-cleanup.test.ts`
covers the cleanup rows, and a device that refuses the removal: the next
start removes the folder. `pack-binary.test.ts` and `pack-notice.test.ts`
beside it cover the "not installed" state and its notice.
