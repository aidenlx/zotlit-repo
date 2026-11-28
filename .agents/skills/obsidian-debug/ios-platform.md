# What differs in Obsidian's iOS WebView

Observed on iOS 18.6 with Obsidian 1.15.1 (2026-11). Desktop tests pass on all of these, because Node and Electron provide what the device lacks. Confirm a fact on the device with [`mobile/ios-eval.py`](mobile/ios-eval.py) or [`mobile/worker-probe.js`](mobile/worker-probe.js) when the system version moved, and make a device check an acceptance criterion of any ticket that depends on one.

## Identity

- `app.appId` is the vault's path, `documents/<vault name>`: it holds a slash, and it changes when the vault is renamed. On desktop it is 16 hex characters. Code that uses it as a folder name gets nested folders; code that validates its form must accept both.

## Missing globals

| Global | Page | Worker | Consequence |
| --- | --- | --- | --- |
| `require` | absent | absent | use Obsidian's globals (`requestUrl`) |
| `Temporal` | absent | absent | a bundle needs the polyfill piece that the product build loads |
| `URLPattern` | absent | absent | Safari ships it from version 26; a module-level use stops the bundle at load |
| `SharedArrayBuffer` | absent | absent | the page is not cross-origin isolated |

A missing global at module load fails the whole bundle. A Worker that fails this way reports an error with no message to its client: read the cause with `worker-probe.js`. A Node test that removes the post-floor APIs catches these only for the APIs on its list, so add each one found here to that list.

## Storage (OPFS)

- In the page: directories and `getFile` only. `createWritable` and `createSyncAccessHandle` are absent.
- In a Worker: `createSyncAccessHandle` works and is fast (2,000 writes of 4 KB and a flush in about 26 ms).
- `getDirectoryHandle` refuses a name with a slash ("Name is invalid"); nested handles work.
- `navigator.storage.estimate().usage` only rises within a session, also after files are removed and after a page reload. To check what is stored, walk the OPFS tree and sum the file sizes.

## Memory and process

- The page and all its Workers share one WebContent process and its limit; see [Memory in ios.md](ios.md#memory). Work that allocates in a Worker can kill the page.
- A backgrounded app or a locked phone pauses the WebView.

## Text

- `Intl.Segmenter` word boundaries differ from V8's: it can mark an alphanumeric identifier such as `AEPV5LC5` as a non-word. Code that indexes or matches identifiers through word segmentation needs a device check.
