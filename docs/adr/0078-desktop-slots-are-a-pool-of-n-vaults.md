---
status: superseded by ADR-0115
---

# Desktop Slots are a pool of N vaults

[ADR 0115](0115-the-end-to-end-run-runs-in-a-container-of-its-own.md) replaces the pool with one Exclusive Hold for host tools. This record describes the former pool.

Supersedes the "one slot" part of ADR 0077. The rest of 0077 still stands: the Desktop Queue, the Memory Gate, Leases and the Admission Deadline.

ADR 0077 kept a single Desktop Slot. Its reason was that two End-to-end Runs in one Obsidian app would steal each other's focus, throttling and reloads. The code says otherwise:

- focus is emulated per window through CDP;
- background throttling is set per window;
- `reload` is sent to one vault with `vault=`;
- all input is synthetic;
- vault windows open behind other apps ([#1663](https://github.com/aidenlx/zotlit/issues/1663)).

Vaults, Fixtures, ports and Paired Zotero profiles were already separate per worktree. Only three things are left that runs share inside the one app:

- **the vault registry**, which every run writes;
- **the window-created hook** that `obsidian-vault open --inactive` installs;
- **the OS clipboard**, which two e2e files write and read.

So admission keeps its shape and the slot becomes a pool:

```text
Desktop Queue (FIFO, no overtaking)
  the head claims when
    a slot of N is free (default 2, ZOTLIT_DESKTOP_SLOTS)
    and no holder from its own worktree has a slot
    or, for an Exclusive Hold, all N slots are free
  → Memory Gate (FIFO, OS pressure permits)
  → Lease → run in the worktree's own vault window
```

- **Exclusive Hold:** `measure:query` takes all N slots, because its timings mean nothing while another run competes for CPU. So does `desktop-slot run --exclusive`, for a manual walk that needs the whole app, such as a screen capture. Everything else takes one slot.
- **The vault registry and the window-created hook:** `obsidian-vault open|remove` runs under a short machine-wide mutex.
- **The clipboard:** each run replaces `electron.clipboard` and `navigator.clipboard` with an in-memory clipboard in its own vault windows. The plugin's copy paths run there, so they are still exercised.

The desktop admission rules below apply to host-desktop runs. [ADR 0115](0115-the-end-to-end-run-runs-in-a-container-of-its-own.md) defines admission for the Run Container, which `pnpm e2e` uses by default.

## Considered options

- **One Obsidian app per run** (`--user-data-dir`): this isolates all app state, but every run would need its own launch, its own login and its own memory. It would also stop attaching to the developer's running app. The app state that remains shared is small enough to close directly.
- **A clipboard lock, or an Exclusive Hold for runs that touch the clipboard:** `paired-run` touches the clipboard and is in every full run, so this would either add a third lock or serialize everything again.
- **Concurrent runs within one worktree:** they would share the vault path, the `dist-dev` build and the Paired Zotero layout. Holders from the same worktree wait for each other, as they did before.
- **Backfilling past a waiting Exclusive Hold:** the Exclusive Hold could starve. Strict FIFO keeps every wait bounded.

## Consequences

- Runs in different worktrees overlap, up to N at a time. Files within one run stay serial, because they share the run's vault.
- N is a guard on contention (CPU, timeouts). Memory stays the Memory Gate's job.
- A waiting Exclusive Hold makes later single-slot waiters wait behind it.
- A test must not use the OS clipboard, and it must not open or remove a vault outside `obsidian-vault`.

## Docs walk update (2026-11-13)

The premise above, that all input is synthetic and vault windows stay behind other apps, holds for the End-to-end Run. A docs walk that records does not keep it: its Zotero and desktop shots bring Zotero to the front, hide Obsidian, and can send real pointer and key input. So a docs-walk run with `DOCS_WALK_CAPTURE=1` or `DOCS_WALK_RECORD=1` takes an Exclusive Hold, like `measure:query`. `DOCS_WALK_NATIVE=1` acts only in a step that records, so `DOCS_WALK_RECORD=1` decides the hold. A run that neither captures nor records takes one slot and leaves the focus where it is. The walk's global setup cannot tell which steps will record, so every recording run takes the hold. A run that captures or records under an outer hold of one slot fails at once and names `pnpm desktop-slot run --exclusive`.

### Window preparation and focus

Turn off Electron's background throttling so renderer frame callbacks
continue in hidden or covered windows. The inactive open hook prepares
the main window before load. Prepare that window again after reload and
prepare each popout when it opens. These settings belong to the individual
`webContents`. Install the in-memory clipboard in each prepared window.

Show popouts behind the active app. Route programmatic focus requests to
CDP emulation so the operating system retains its focus. Start with the
main window and emulate focus for one window at a time. Apply requests in
order and report focus only after it takes effect, so CodeMirror receives
the correct focus and caret events. Drain requests from focus handlers
before continuing. A closed popout can receive a late focus event from
Chromium. Return focus to the main window so Obsidian's active window
keeps usable clipboard and timer APIs. Before opening a dialog from a
synthetic press, transfer emulated focus after native layout settles,
because the press itself does not transfer it. Wait for window width and
sidebar changes to settle before checking the resulting layout.

For a startup-order test, reload the vault window. A plugin loaded at
startup can subscribe to rename events before the metadata cache moves
the path. A plugin reload subscribes later and can hide such bugs. Flush
settings and save layout, release the old hooks, and schedule the reload
after replying. Mark the old window so polling waits for the new layout,
loaded plugins, and registered commands. Reinstall background and focus
hooks after the new window is ready.

[Window preparation](../../packages/e2e/src/background-throttling.ts) ·
[Window reload](../../packages/e2e/src/window-reload.ts)

### Admission and run evidence

Take the Desktop Slot and pin the PDF sidebar before opening a run vault or
starting Paired Zotero. A run can skip without admission when Obsidian is
unreachable. Exit 75 at the admission deadline and 76 on Lease expiration
because Vitest translates thrown setup errors to exit 1. Run files in
sequence within one slot because they share the vault and emulated focus.
Run docs walks separately from the release suite. Each opens a Paired Run,
and the first failed step ends that walk.

Use a distinct results folder keyed by start time and process ID. A parent
can choose the folder before launching the run. The reporter writes
console evidence there, points `latest` to the last started run, retains
recent runs, and removes the older flat output filenames. It renews the
Lease at file, case, and hook milestones. If a failed run ends with an
unavailable display, report that state because tests that read paint
depend on it.

Desktop setup (removed by [ADR 0118](0118-journeys-run-and-are-inspected-only-in-the-run-container.md)) ·
[Reporter](../../packages/e2e/src/reporter.ts) ·
[Results directory](../../packages/e2e/src/results-dir.ts)

### PDF sidebar pin

Set the app-wide `pdfjs.sidebarView` key to zero before a run opens its
first PDF. Obsidian reads this key on open. It overrides per-file
history, so an open thumbnail sidebar can move the page during a
geometry check. An eval in any vault window can read or write the shared
key. Return an explicit acknowledgement because an eval with no return
value gives no reply marker.

Use a state file under the machine-wide mutex to count overlapping runs.
The first hold records the previous value before writing the pin. Each
later hold joins it. The last release restores the recorded value, which
can be absent. Remove dead holders during the next pin or release. When
a leftover file has no live holder and the key has changed, use the
newer value chosen in the app. Record a release before attempting its
restore so a failed write leaves the saved value available. Cover live
overlap, a dead holder, and a failed restore in the unit tests.

[PDF sidebar pin](../../packages/e2e/src/pdf-sidebar-pin.ts) ·
[Pin tests](../../packages/e2e/src/pdf-sidebar-pin.test.ts)

### Query measurement hold

Measure under an Exclusive Hold because concurrent desktop work can
change timing. Require a visible vault window and repeat a run made
while it was hidden. Show a hidden or minimized window behind other
apps without changing operating system focus. The measurement
proceeds once the window is visible. Renew the Lease on logged
progress. Record elapsed time against the Lease cap. Restore the PDF
sidebar pin in the cleanup block before an explicit process exit
can skip disposal.

[Query measurement admission](../../packages/e2e/src/query-measure.ts)

Install one clipboard store per vault window. Repeat setup keeps the
store. Replace methods of both Electron's clipboard object and
`navigator.clipboard`. The plugin still calls its normal APIs,
because Electron returns the same renderer clipboard object. Store
plain text and HTML, the formats that the plugin uses.

[Run clipboard](../../packages/e2e/src/memory-clipboard.ts) ·
[Electron renderer clipboard](https://github.com/electron/electron/blob/v43.3.0/lib/renderer/api/clipboard.ts)

### Excerpt import settlement in the shared test vault

The Fixture already has the Imported Note, so the import can ask
before overwriting it. Answer that prompt and poll for settlement
together because the prompt blocks completion. Run the import as
an app-owned job and record its settlement. An expired or killed
CLI observation can end before the vault operation does. Cache
the result reported by the app and allow another observation
after a CLI failure.

Register restoration before writes. Wait for settlement before
restoring the note and settings, removing new assets or clearing
the job state. Restore layout before the per-Item color filter
so no remaining view can save the test value back. Report the
restoration failure follow-up in the issue tracker. [Issue 182](https://github.com/aidenlx/zotlit-repo/issues/182)

[Import settlement and restore](../../packages/e2e/src/excerpt-acceptance.ts)

### Native desktop shots

Use real desktop input only for shots outside the page, such
as a macOS menu or file dialog. Take the Exclusive Hold and
use an unattended window with other apps hidden. Confirm the
app is frontmost before input. Check the capture region for
other windows. If another app takes the front during capture,
discard the shot's frames before retrying. A step can end the
shot without rest when later frames must stay out.

Use the capture frame wall clock for action times. Wait for
ffmpeg to report a frame before sending actions, and drain
its progress stream to avoid blocking the recorder. The
first captured frame starts the shot. Crop to the recorded
region, encode only through the shot end, and blur any private
regions. The native recording includes the system pointer.

[Native desktop recorder](../../packages/e2e/src/docs-walks/macos-desktop.ts)

A docs walk uses its own Paired Run and Vault Case to replay one
lesson. Close the Zotero library setup section by writing the
same setting its dismiss action writes. Setup skips an unreachable
Obsidian. Otherwise it checks both dev bundles for freshness,
takes the required hold, and pins the PDF sidebar. Reject a
single-slot outer hold when the walk needs exclusive admission.

[Docs walk admission](../../packages/e2e/src/docs-walks/docs-walk-setup.ts) ·
[Paired lesson harness](../../packages/e2e/src/docs-walks/docs-walk.ts)

### Obsidian CLI transport and Host Vault readiness

Use the shared bounded socket client for scripts and the
End-to-end Run. The native macOS CLI could print a reply
then wait indefinitely for connection closure. In a mixed
eval run it missed about one in 1,100 replies. The socket
client missed none in 17,800. Read until the stream ends and
preserve native connection errors. Escape requests to ASCII
because Obsidian decodes each chunk separately. A split
multibyte sequence would otherwise change the text.

Race the deadline so a runner that ignores abort cannot hold
the script. Close the connection on abort and consume the
losing rejection. Preserve a caller abort or transport
failure. Use an unreachable-vault error for the wrapper
deadline. A crashed renderer can remain registered as open
while other windows answer. Restart Obsidian to recover the
silent target.

Discover open vaults through a call with no vault selector.
A targeted call opens a registered but closed vault. When
there is no open Host Vault, prefer the sandbox, then the
most recently opened eligible vault. Exclude the path the
caller asked to avoid. Allow longer for opening and report
the original failure if discovery cannot answer. Obsidian
checks ID and case-insensitive folder name together.

Edit the registry directly only after Obsidian shuts down.
The running app can overwrite a file edit with its in-memory
copy. Stage and rename the registry to protect other vaults
from a partial write. Remove the unregistered vault's state
and Partition after the registry update.

[CLI client](../../packages/scripts/lib/obsidian-cli.ts) ·
[Host Vault discovery](../../packages/scripts/lib/obsidian-host-readiness.ts) ·
[Vault registry](../../packages/scripts/lib/obsidian-vault-registry.ts)

### DevTools window selection

Match main windows and child targets to a vault through
their app or opener. Include a silent target in the window
list. Select by unique target prefix or by the vault's main
window. Reject outstanding calls when the socket closes
because sending to a closed connection can wait out the
deadline. DevTools eval supports top-level await, and a
returned promise needs its own await. A renderer target and
the main-process inspector use separate connections.

Give trusted input and focus probes a focused window. An
unfocused probe can appear to succeed without exercising
input or focus. A throttle probe restores every window's
previous setting.

[DevTools client](../../packages/scripts/lib/obsidian-cdp.ts) ·
[CLI probes](../../packages/scripts/scripts/obsidian-cli.ts)

### Development Vault lifecycle

Use the worktree name as part of the vault's folder name because the CLI
resolves by basename. Give each nondefault Vault Case its own suffix.
The Vite dev build and vault command use the same case from
`ZT_VAULT_CASE`. A fresh Development Vault starts with the generated
Fixture Vault. `--fixture-root` selects a different Fixture before the
command runs.

Obsidian keeps the registry in its main process and rewrites
`obsidian.json`. Use CLI eval and its vault IPC channels while the app
runs. Edit the registry file only while the app is shut. CLI creation
requires the Obsidian CLI enabled and a registered vault to host eval.
Prefer the focused window and try the registered sandbox first when
a host must be opened. A CLI reply, including “Vault not found,”
indicates a running app. Treat an unreachable window as a live app and
keep the CLI probe bounded. Retry transient replies, and stop retrying
when the window is gone.

Serialize registry changes across worktrees. For an inactive open, bind
the window-created hook only for the call. Use `showInactive` and then
blur on macOS so the window stays behind the focused app. Suppress its
focus request and turn off background throttling before it loads.
An unfocused renderer can otherwise exceed the CLI timeout under load.
The throttling setting survives reloads.

Preserve a dev bundle already staged in a fresh vault, and place the
bundle before opening. Open the existing folder with create disabled.
Wait for the Restricted Mode command before trusting the vault. Trust
reloads the window and loads the seeded list of plugins. Wait for the
new page because eval can be briefly unavailable during that reload.
Check that the plugin object exists, since the enabled list only mirrors
the file. After reopening, retry plugin reload while the command
registry catches up with the open flag.

Sync uses the same registered folder. Build the Fixture Vault before a
purge and use the cached or fresh `dist-dev` output so stale vault
contents cannot replace a new bundle. Fall back to the target's bundle
only when the dev output is absent. Disable the loaded plugin on Windows
before sync to release its handles, and on all platforms before a purge
so it cannot recreate cleared storage. Purge removes obsolete files and
clears ZotLit device state and databases while keeping Obsidian's trust
state.

Close an open target before unregistering it, after disabling ZotLit.
Targeting a closed window would reopen it. Choose a surviving host for
IPC. When closing the only open window shuts the app, unregister
offline. If Obsidian remains open, open another registered vault as
the host, or report the offline command when none is available. Never
start Obsidian just for cleanup.

Online cleanup uses a surviving window to clear localStorage and IndexedDB
under the vault ID in the shared Obsidian origin. These records, including
excerpt storage, outlive the folder. A prefix selects one owner during
sync. A blocked IndexedDB deletion proceeds when its open connection closes,
so cleanup can continue. Offline unregister leaves browser storage alone.
An explicit purge also removes the eligible directory after an unregister
failure so Obsidian can drop a missing registry entry at its next start.
Allow a purge outside Git, and refuse it on unverified Git errors or
tracked files.

The Fixture's standalone Zotero shares its Local API port with its
vault through the generated profile. Use the Fixture's port so the
machine's normal Zotero can keep the default one. Report the standalone
instance as a holder of `zotero.sqlite` so a rebuild sees it. It has no
debugging port. Stop it before deleting its profile, while it can still
be located.

[Development Vault command](../../packages/scripts/scripts/obsidian-vault.ts) ·
[Fixture command](../../packages/scripts/scripts/fixture.ts)

### Shared End-to-end Run helpers

Share one Fixture Vault and its lifecycle across the area's test files.
Point every profile rebuild at the run-owned loopback endpoint that
drops connections so the plugin sees Zotero offline. Leave the default
port to the developer's Zotero. Derive expected activity and Library IDs
from Fixture facts independently of Query output.

Use a durable host vault outside all run vaults for registry calls.
Name the temporary vault folder by worktree, open it inactive, and
purge its registration, storage, and directory on teardown. A
configured host that is closed is a setup failure. The setup recognizes
the readiness command's error for that state. Keep enabled bundles
and installed-only bundles distinct.

Serialize self-contained page helpers into the receiving window. Their
runtime dependencies must be available there. Target visible labels and
ARIA references without triggering Obsidian tooltips. Resolve Query View
popovers in the owning document, opening only when needed. Read editor
layout after native completion when available and poll for later state
changes. Pass a currentTarget to synthetic menu actions. Fields popovers
also belong to their window's document. Check Workbench tab spacing only
with all tabs on one line.

An Item search can still show the previous results while busy. Wait for the
new answer and distinguish same-title rows by Indexed Key. Move the pointer
again if rerender selects a different row. Capture notices across documents
because closing a window moves later notices to the main window. Read
Managed Region boundaries from the rendered note. Restore a minimized
window while transparent and reorder it behind the focused app. Keep
background windows rendering. Stop ZotLit and wait for its service and PDF
tab bindings to release before setting up its next start.

The harness uses host-only install notifications and manifest reloads to
test real install and uninstall behavior and can inspect open Node handles.
[Page helpers](../../packages/e2e/src/page-helpers.ts) ·
[Vault commands](../../packages/e2e/src/vault-script.ts)

CLI eval stays in the main window even when a popout is active. Emulate
focus so covered windows can paint. For retained-object checks, exclude
DevTools console references to logged objects. Await observations before
leaving the cleanup scope, and dismiss any leftover dialog in teardown.
