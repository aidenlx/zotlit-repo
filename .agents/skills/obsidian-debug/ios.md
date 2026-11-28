# Obsidian on a real iPhone

The Mac drives the iPhone's Obsidian WebView through Web Inspector with `pymobiledevice3`. Scripts in [`mobile/`](mobile/) do the evaluation. Any agent with shell access on the Mac can attach; the owner does what only a hand can do (unlock, force-quit, relaunch).

Before you design or debug against a platform fact (an API, the vault ID, storage, memory), read [ios-platform.md](ios-platform.md): the iOS WebView differs from the desktop renderer in ways that the desktop tests do not show.

## Attach

1. **Connect.** The owner connects the iPhone over USB, keeps it unlocked with Obsidian in the foreground, and enables Web Inspector under Settings → Apps → Safari → Advanced (iOS 18 and later; Settings → Safari before).
2. **Find the WebView.** Continue when the list shows `Obsidian … capacitor://localhost`. With several devices, add `--udid <device-id>`.

   ```sh
   uvx pymobiledevice3@11.54.0 webinspector opened-tabs --timeout 6
   ```

3. **Evaluate.** Run a JavaScript file or stdin through [`mobile/ios-eval.py`](mobile/ios-eval.py) (`<file|-> [seconds]`). It awaits the expression inside the page and prints the settled value.

   ```sh
   uv run --no-project --with pymobiledevice3==11.54.0 python .agents/skills/obsidian-debug/mobile/ios-eval.py \
     .agents/skills/obsidian-debug/mobile/ios-ping.js 20
   ```

   Expect vault, `visibility: "visible"` and a `timeOrigin`. Confirm the vault name before any vault write.

The device takes one inspector session at a time. `ios-eval.py` holds a machine-wide lock for its session, so agents in other worktrees queue behind it, and it ends by itself at its deadline: give it the seconds you can wait and let it exit. Its exit code names the outcome:

| Exit | Output | Meaning |
| --- | --- | --- |
| 0 | the value | settled |
| 1 | `ERROR <stack>` | the expression threw |
| 2 | `TIMEOUT`, `NO ANSWER`, `NO PAGE` | still running, or the inspector is silent |
| 3 | `PAGE RELOADED` | the page that ran the expression was replaced |
| 4 | `DEVICE BUSY <holder>` | another session held the device for the whole wait |

## When the device goes silent

A silent inspector has three causes, and the first is the common one after heavy work. Run the ping above, then follow the first row that matches:

| Ping result | Cause | Next |
| --- | --- | --- |
| Answers, `timeOrigin` later than your run's | iOS replaced the WebView process: the page reloaded with no message, and plugin state in memory is gone | Record "page reloaded" as the result of that step; read [Memory](#memory) for the reason |
| Answers, same `timeOrigin` | Your expression is still running | Wait, or read its progress from the vault |
| No answer, twice, 60 s apart | The phone is locked or Obsidian is in the background | Ask the owner to unlock and bring Obsidian forward; continue other work meanwhile |

An evaluation in flight when the process is replaced never returns, so it looks like a locked phone. Ping before you ask a person.

## Long runs

A run that outlives one evaluation must survive a reload and a dropped session:

- Start it with a short evaluation and poll its state with further short ones.
- Have the code on the device write its progress and partial results to a vault file after each step; read that file after a reload.
- Record `performance.timeOrigin` at the start. A later value that differs by more than a second means the page reloaded: stop polling the old state. The value loses precision through the inspector, so compare with a tolerance.
- Keep any server the device fetches from alive until the device reports done or failed.

## Move files to the phone

`Runtime.evaluate` stalls on expressions of 16 KB and more, so a plugin build, a PDF or a large probe script goes over the local network:

1. Serve the files from the Mac on its LAN address: `python3 -m http.server 8765 --bind "$(ipconfig getifaddr en0)"` in the staging folder.
2. In the page, fetch with the global `requestUrl` and write with `app.vault.adapter.writeBinary(path, response.arrayBuffer)`.
3. The first request from Obsidian makes iOS ask for Local Network access; until the owner allows it, requests fail with "The Internet connection appears to be offline".

A shell with a proxy (Surge) answers the Mac's own `curl` to that address with 503; check it with `curl --noproxy '*'`.

A Worker on the device can `fetch` a LAN `http://` server directly when the server binds the LAN address and answers CORS: the preflight `OPTIONS`, every request header the client sends in `Access-Control-Allow-Headers`, and the response headers the client reads in `Access-Control-Expose-Headers`. Safari reports a refused preflight only as a bare `TypeError` or "Load failed": check the server's CORS answer first.

## Run a plugin build

- Write `main.js`, `styles.css` and `manifest.json` under `.obsidian/plugins/<id>/` in a disposable vault. For a desktop-only plugin, set `isDesktopOnly: false` in that vault's copy of the manifest only.
- Enable with `await app.plugins.setEnable(true); await app.plugins.enablePluginAndSave(id)`. It answers `false` on a failure and logs "Plugin failure: <id>" to `console.error`; wrap `console.error` during the call and log `error.name + ": " + error.message`, because Safari's stack holds no message.

## Workers

The inspector session shows the page only. [`mobile/worker-probe.js`](mobile/worker-probe.js) is the template for both Worker jobs: edit `probe` to run a check inside a Blob-URL Worker and get its value back, or set `vaultPath` to start a built Worker text from the vault and get its `error` events with message, line and column. A Worker that fails at load reaches its RPC client as an error with no message, so start the text this way to read the cause.

## Memory

The page has no memory API. Read memory from the Mac:

- **Limit.** The page and its Workers are one `com.apple.WebKit.WebContent` process with a per-process limit set by the device (1,536 MB on a 3 GB iPhone). Above it, iOS kills the process and the page reloads.
- **Footprint during a run.** Stream every WebContent process and keep the timestamps; a device can hold a second, idle WebContent process, so match footprint and CPU to your run instead of trusting the newest PID. A 500 ms interval gives a lower bound on the peak.

  ```sh
  uvx pymobiledevice3@11.54.0 developer dvt sysmon process monitor threshold 0 --userspace \
    --key name --key pid --key physFootprint --key cpuTotalUser --duration 600000
  ```

- **After a reload.** `uvx pymobiledevice3@11.54.0 crash ls`, then `crash pull <dir> --match JetsamEvent`. A JetsamEvent that names `com.apple.WebKit.WebContent` with reason `highwater` is a memory kill; `rpages` × 16 KB is the footprint at the kill. iOS does not write a report for every reload, so a missing report leaves the cause open.

## Start-up time

Obsidian's own number for each plugin is the `communityPlugins.<id>` row of Settings → General → "Check for slow startup" → timer button. Ask the owner to force-quit Obsidian (swipe it away) and open it again, once per sample, then read the breakdown with [`mobile/startup-time.js`](mobile/startup-time.js). The first start after a new `main.js` is the "first start after an update"; later ones are daily starts.

## Clean up

Stop the file server and any monitor. Leave the test vault to the owner, and name what is still installed in it.

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
