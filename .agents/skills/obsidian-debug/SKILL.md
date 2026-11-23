---
name: obsidian-debug
description: |
  Drive the running Obsidian instance to verify plugin changes — build, reload, eval, screenshot.
  Use after editing plugin UI or behavior to confirm the change works in the real app, when
  debugging why something looks wrong at runtime, or when another skill says "verify in Obsidian."
  Also use when the user asks to test, check, run, or screenshot the plugin, or to inspect
  desktop Obsidian with CDP, iOS with Safari Web Inspector, or Android with adb and CDP.
---

# Debug Loop

Drive the running Obsidian app to verify plugin changes against real rendered state. The DOM
is the source of truth.

**iOS** — for a real iPhone, follow [ios.md](ios.md) to attach to the Obsidian WebView, install a
plugin build, and read start-up time from the Mac.

**Android** — follow [android.md](android.md) to set up the global emulator or a USB device, attach
to the Obsidian WebView and its Workers, install a plugin build, and read start-up time and memory.

On desktop, make every Obsidian CLI call through `packages/scripts/scripts/obsidian-cli.ts` (written
`obsidian-cli.ts` below), run from the repo root. It takes the `obsidian` binary's arguments
and prints its output, and it always sees the end of a reply — the binary can miss it on macOS
and wait until killed.

**DevTools** — when the CLI cannot show it (DOM and CSS internals, network, profiles,
breakpoints, popout or settings windows, the main process), follow [devtools.md](devtools.md).

## Vault setup, once per worktree

1. Run `packages/scripts/scripts/obsidian-cli.ts version`. It must print Obsidian's version.
   Read `obsidian-cli.ts --help` for its arguments, timeout, and exit codes.
2. Run `packages/scripts/scripts/obsidian-vault.ts --help`.
3. Before you use a vault command, read its `<command> --help` output.
4. Run `packages/scripts/scripts/obsidian-vault.ts check`. Vault setup is
   complete when the command succeeds. Follow its recovery instructions when
   it fails.
5. Build the plugins, then use the live `open` command to prepare this
   worktree's Development Vault:

```bash
pnpm --filter @zotlit/obsidian build:dev
pnpm exec turbo run build:dev --filter=@zotlit/reader
```

The commands build ZotLit and the reader and copy them into the vault. Workspace packages
export TypeScript source, so ZotLit's bundle needs no prerequisite build. The reader's
`build:dev` task runs its generators first, so the turbo command works on a fresh worktree.

Formatted citations read the Resource Pack. Build it, then make the open vault read its
manifest:

```bash
pnpm --filter @zotlit/resources build:dev
packages/scripts/scripts/obsidian-cli.ts \
  --code '(async()=>{await app.plugins.loadManifests();return "loaded"})()' vault=<id>
```

`obsidian-vault.ts open --install zotlit-resources` loads the manifests as part of the open.

Editing the Fixture Spec or its committed vault-page assets changes the next
Fixture build, not the open Development Vault. Use the live `open` command
before you look for those changes.

## Teardown

When the check is done, close what the check opened, in this order:

1. `pnpm fixture stop` — closes a Paired Zotero that `pnpm fixture open` left running.
2. `packages/scripts/scripts/obsidian-vault.ts remove --purge` — removes the Development Vault.

## Commands

| Command | What it does |
|---|---|
| `obsidian-cli.ts vault=<id> plugin:reload id=zotlit` | Reload the plugin after a build |
| `obsidian-cli.ts vault=<id> commands filter=zotlit` | List available plugin commands |
| `obsidian-cli.ts vault=<id> command id=zotlit:<cmd>` | Run a command |
| `obsidian-cli.ts --code '<js>' vault=<id>` | Run JS in the app, returns the value |
| `obsidian-cli.ts --js <file.js> vault=<id>` | Run a JS file in the app; use it for multi-line probes |
| `obsidian-cli.ts --shot <file> --selector <css> vault=<id>` | Capture one element; `--sample x,y` reads a pixel's colour |
| `obsidian-cli.ts vault=<id> dev:screenshot path=<abs>` | Capture the window (absolute path required) |
| `obsidian-cli.ts vault=<id> dev:errors` | Captured errors |
| `obsidian-cli.ts vault=<id> dev:console` | Console output |

Read the output text: `=> ` prefixes a result, and command failures come back as `Error: …` or
`Vault not found.`

Write each call as one plain command with literal values: `<id>` is the vault ID
`obsidian-vault.ts id` prints, typed out, and JS goes through `--code` or `--js`.

## Loop

Take the host desktop’s Exclusive Hold for the walk: wrap it in `pnpm desktop-slot run -- …` (a script of the walk, or `sleep 86400` as a background task while you make the calls). End the walk with `pnpm desktop-slot status`, which prints each holder as `pid <pid> (<command>) in <worktree>`, then `pnpm desktop-slot evict <pid>` with the pid of the line that names this worktree. The hold stops its command's process group and releases the slot; a script of the walk ends by itself. Run Vault setup before you take the hold, and Teardown after you release it. Each `obsidian-vault.ts` command takes the slot itself: while your hold from this worktree has it, the command exits 75 and prints the `ZOTLIT_DESKTOP_SLOT=<token>` prefix that runs it inside your hold. Exit 75 means blocked by the holder it names, not a failure. When another run waits, the hold prints a notice and ends 5 min later with exit 76; report that the walk yielded, and hold the slot again after that run.

1. **Build** — the build commands from Vault setup step 5. The `build:dev` commands copy the
   bundles into this worktree's Development Vault; prefix them with `ZT_VAULT_CASE=<case>`
   to copy into a Vault Case vault, such as the `upgrader` vault. The Hot Reload plugin
   loads each bundle the moment it lands, so run a check of the base build before the first
   rebuild.
2. **Reload** — `obsidian-cli.ts vault=<id> plugin:reload id=zotlit`. A leaf or embed open
   across the reload keeps the old build's DOM: run `leaf.rebuildView()` on each ZotLit leaf,
   or the note holding the embed, or open a fresh one, before you probe.
3. **Open** — `obsidian-cli.ts vault=<id> command id=zotlit:<cmd>`, or `--code` to mount a view in a specific split.
4. **Probe** — `obsidian-cli.ts --code '…' vault=<id>` with `getComputedStyle(el)` /
   `el.getBoundingClientRect()` to assert what actually rendered. A computed-style assertion is
   worth more than eyeballing a screenshot, and it is the only way to catch a state that expires
   on its own — a flash class is gone by the time the capture lands.
5. **Screenshot** — `obsidian-cli.ts --shot <file> --selector <css> vault=<id>` for the surface under test;
   `dev:screenshot` when the whole window matters. Save inside the workspace. A colour question —
   a fade, a blend, a border — is answered by `--sample`, not by eye. `obsidian-cli.ts --help` has the
   options.
6. **Errors** — `obsidian-cli.ts vault=<id> dev:errors` / `dev:console`.

## Driving state

Values change through code, and DOM ops check how the UI looks and behaves.

| Target | Expression |
|---|---|
| Obsidian app config | `app.vault.setConfig(key, value)` |
| Fixture database write | Fork the built data, save `dataDirOverride` from [the active Zotero paths](#read-the-active-zotero-paths), point the plugin at the fork with `setDataDir`, write to the fork, restore the saved override, then remove the fork. Follow [Write to a data fork](../../../docs/fixture.md#write-to-a-data-fork). |
| ZotLit setting | `app.plugins.plugins.zotlit.settingTab.setControlValue("citation.at-trigger", false)` |

`setControlValue` runs the same `SettingsService` path the rendered control does and persists to
the plugin's `data.json`; `getControlValue` reads the effective value back. Read the value first
and put it back when you are done.

## Gotchas

### Settings land in their own window

`app.setting.open()` renders into a separate Electron window by default since 1.13.4, and `--code`,
`dev:dom`, and `dev:screenshot` all address the main one — so settings read as never opened. Run
`/obsidian-settings` → "Verifying on screen" for the config that brings the modal back into the
main window, and for reaching the separate window when its own chrome is the thing under test.

### Async work in `--code`

Code run through `--code` or `--js` runs in a non-async wrapper — top-level `await` is a syntax error. Return the
promise from an async IIFE; the CLI awaits it and prints the settled value. Hold the leaf from `getLeaf(...)`
and `revealLeaf(it)` in the same call rather than re-querying `getLeavesOfType(...)` after an
async `setViewState` (races, returns `[]`).

### Trusted input

`el.click()` and `dispatchEvent(new KeyboardEvent(…))` send untrusted events. The browser
skips its own handling for them: Escape and a click outside never close a `popover="auto"`,
and close watchers group stacked popovers as one, so one Escape closes both. When the
browser's handling is the thing under test — popover light-dismiss, close watchers, user
activation — send trusted input through the window's `webContents`, no CDP needed:

```js
const wc = require("@electron/remote").getCurrentWebContents();
wc.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
wc.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
```

Use `mouseDown`/`mouseUp` with `x`, `y`, `button: "left"`, `clickCount: 1` for a click at a
point. The window must hold focus, `document.hasFocus()` true, or the input and every focus
event go nowhere while `activeElement` still moves; pass `--no-throttle`, which warns when
the window lacks focus. Call `getCurrentWindow().focus()` first; when the user is working in
another app, the window may not keep it, and the check waits for them.

A pop-out is a window of its own: send its input through its own `webContents`, from
`require("@electron/remote").BrowserWindow.getAllWindows()`, and focus that window first.

Edit-menu shortcuts — Cmd+Z, Cmd+Shift+Z, Cmd+C, Cmd+V — reach the page as a trusted
`keydown` but never run the menu's own action, even in a plain `<input>`. Check that the
`keydown` arrives unprevented and goes where it should, then run the action as the menu
does: `webContents.undo()`, `.redo()`, `.copy()`, `.paste()`.

### Menus bind their keys late

A `Menu` binds its keys a timer after it shows
([keyboard-scope.md](../../../apps/obsidian/policies/keyboard-scope.md) has why that orders
its Scope). A menu closed before that timer fires leaves its keys bound, and they swallow
the next Enter. Between seeing a menu and pressing one of its items, wait one
timer; E2E cases await `page.menuReady()` from `packages/e2e/src/page-helpers.ts`.

### CodeMirror editors

Reach an editor's `EditorView` from its content element: `el.querySelector('.cm-content').cmTile.root.view`.
Drive it with `view.dispatch({changes, userEvent: 'input.type'})` and read `view.state.doc.toString()`.
A pane mounts its editor after the click that opens it, and a row that holds fixed text has no editor —
poll until the editor exists before you drive it.

### Stale screenshots

A capture taken right after reload or `revealLeaf` may show old DOM while the change is already
live. Cross-check against a `--code` DOM/computed-style query — if they disagree, the DOM query
wins. Re-shoot. A DevTools window open over Obsidian can also steal the capture — close it first.

### Confirm which vault answered

A command without a leading `vault=` goes to the vault that holds the current folder, else to
the focused window — either may belong to another worktree. Pass
`vault=<id>` as the first argument, and confirm with `--code 'app.vault.adapter.basePath'` — it must print the
Development Vault path reported by `obsidian-vault.ts --help` for the worktree you build
from. `data.json` edits target that same path.

### Hidden window

A hidden, minimized, or covered window is throttled: `requestAnimationFrame` never fires, so a
probe that awaits one never answers; scroll events never dispatch; and screenshots lag one frame
behind the DOM. Pass `--no-throttle` to every call that probes, scrolls, or captures: it lifts
throttling from the main window and its popouts for that call and puts it back after.
`document.visibilityState` can still read `hidden` — judge by frames and events.

### Focus without the OS

A window the user has not focused reports `document.hasFocus()` false, and so does a CodeMirror
`view.hasFocus`: Live Preview reveal and other focus-dependent editor behaviour stay off.
Emulate focus through the window's debugger. The window keeps its place and the user's app keeps focus
(`packages/e2e/src/background-throttling.ts` does the same):

```js
(async()=>{const wc=require("@electron/remote").getCurrentWebContents();
if(!wc.debugger.isAttached())wc.debugger.attach("1.3");
await wc.debugger.sendCommand("Emulation.setFocusEmulationEnabled",{enabled:true});
return document.hasFocus();})()
```

Send `{enabled:false}` when the check is done.

### Read the active Zotero paths

`zoteroPref` is an Effect service: read it through the plugin's bridge. The supported check is
`packages/scripts/scripts/obsidian-vault.ts check`: it reports whether ZotLit in the open
Development Vault reads the Fixture's profile and database. For the values themselves:

```bash
packages/scripts/scripts/obsidian-cli.ts \
  --code '{const s=app.plugins.plugins.zotlit.services;const p=s.bridge.runSync(s.zoteroPref.current);JSON.stringify({profileDir:p.resolvedProfileDir,databasePath:p.databasePath,dataDirOverride:p.dataDirOverride})}' vault=<id>
```

Change the data directory with `s.bridge.runSync(s.zoteroPref.setDataDir("<absolute path>"))`, and
call it again with the saved `dataDirOverride`, or `null` when it was empty, to restore it.

### Full-scale Fixture data

Build a Stress Build with `pnpm fixture stress`. Read the current Device Override with the
snippet in [Read the active Zotero paths](#read-the-active-zotero-paths), then point the live
plugin at the absolute `.scratch/acceptance-fixture/zotero-data` path:

```bash
packages/scripts/scripts/obsidian-cli.ts \
  --code '{const s=app.plugins.plugins.zotlit.services;s.bridge.runSync(s.zoteroPref.setDataDir("<absolute path>"));"set"}' vault=<id>
```

Afterwards, restore the saved override as that section describes. This restores the vault-scoped
Device Override and reconnects the database service.
