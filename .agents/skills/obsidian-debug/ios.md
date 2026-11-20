# Obsidian on a real iPhone

The Mac drives the iPhone's Obsidian WebView through Web Inspector with `pymobiledevice3`. Scripts in [`mobile/`](mobile/) do the evaluation; the owner does what only a hand can do (unlock, force-quit, relaunch).

## Attach

1. **Connect.** The owner connects the iPhone over USB, keeps it unlocked with Obsidian in the foreground, and enables Web Inspector under Settings → Apps → Safari → Advanced (iOS 18 and later; Settings → Safari before). A locked phone or a backgrounded app pauses the WebView, and every evaluation hangs until it is back.
2. **Find the WebView.** Continue when the list shows `Obsidian … capacitor://localhost`. With several devices, add `--udid <device-id>`.

   ```sh
   uvx pymobiledevice3@11.54.0 webinspector opened-tabs --timeout 6
   ```

3. **Evaluate.** Run JavaScript files or stdin through [`mobile/ios-eval.py`](mobile/ios-eval.py). It awaits the expression inside the page (it stores the settled value in a temporary global and polls it, because the inspector returns before a promise settles) and prints the value or `ERROR <stack>`. Keep one inspector session at a time; a killed session can leave the next one hanging until the app returns to the foreground.

   ```sh
   echo '(async () => ({ origin: location.origin, vault: app.vault.getName() }))()' \
     | uv run --no-project --with pymobiledevice3==11.54.0 python .agents/skills/obsidian-debug/mobile/ios-eval.py - 30
   ```

   Expect `capacitor://localhost`, and confirm the vault name before any vault write.

## Move files to the phone

`Runtime.evaluate` stalls on expressions of 16 KB and more, so a plugin build or a PDF goes over the local network:

1. Serve the files from the Mac on its LAN address: `python3 -m http.server 8765 --bind "$(ipconfig getifaddr en0)"` in the staging folder.
2. In the page, fetch with the global `requestUrl` (mobile has no `require`) and write with `app.vault.adapter.writeBinary(path, response.arrayBuffer)`.
3. The first request from Obsidian makes iOS ask for Local Network access; until the owner allows it, requests fail with "The Internet connection appears to be offline".

A shell with a proxy (Surge) answers the Mac's own `curl` to that address with 503; check it with `curl --noproxy '*'`.

## Run a plugin build

- Write `main.js`, `styles.css` and `manifest.json` under `.obsidian/plugins/<id>/` in a disposable vault. For a desktop-only plugin, set `isDesktopOnly: false` in that vault's copy of the manifest only.
- Enable with `await app.plugins.setEnable(true); await app.plugins.enablePluginAndSave(id)`. It answers `false` on a failure and logs "Plugin failure: <id>" to `console.error`; wrap `console.error` during the call and log `error.name + ": " + error.message`, because Safari's stack holds no message.

## Start-up time

Obsidian's own number for each plugin is the `communityPlugins.<id>` row of Settings → General → "Check for slow startup" → timer button. Ask the owner to force-quit Obsidian (swipe it away) and open it again, once per sample, then read the breakdown with [`mobile/startup-time.js`](mobile/startup-time.js). The first start after a new `main.js` is the "first start after an update"; later ones are daily starts.

## Limits

- No JavaScript memory API (`performance.memory`, process info) on iOS; memory needs Xcode Instruments.
- Workers are not visible to this inspector session; probe them by running the check inside a Blob-URL Worker and posting the result back.

## Clean up

Stop the file server. Leave the test vault to the owner, and name what is still installed in it.

## CLI cache in a restricted workspace

If `pymobiledevice3` fails when it creates its cache under the Mac home directory, use a workspace-local cache. Save this as `.scratch/obsidian-ios/inspector.py`:

```python
from pathlib import Path

from pymobiledevice3 import common
from pymobiledevice3.__main__ import main

common._HOMEFOLDER = Path(__file__).resolve().parent / "device-cache"
main()
```

Replace `uvx pymobiledevice3@11.54.0` in the commands above with `uv run --no-project --with pymobiledevice3==11.54.0 python .scratch/obsidian-ios/inspector.py`. If uv's cache also needs a writable location, set `UV_CACHE_DIR` to a path under `.scratch/`.

See [Apple's iOS inspection guide](https://developer.apple.com/documentation/safari-developer-tools/inspecting-ios) and the [pymobiledevice3 Web Inspector CLI reference](https://doronz88.github.io/pymobiledevice3/latest/cli/webinspector/).
