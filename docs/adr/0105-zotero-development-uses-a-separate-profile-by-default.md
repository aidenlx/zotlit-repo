# Zotero development uses a separate profile by default

The Companion's watch build starts Zotero, installs the add-on through
RDP, and reloads it after a successful build. Copy
`apps/zotero/.env.example` to `apps/zotero/.env` and set
`ZOTERO_PLUGIN_ZOTERO_BIN_PATH` to the Zotero executable. The runner
uses a development profile and data folder under
`apps/zotero/.zotero-dev/` by default. This gives the runner a profile
where it can configure remote debugging separately from the user's
normal profile.

Set `ZOTERO_PLUGIN_PROFILE_PATH` to use an existing development profile.
With only a profile override, Zotero uses that profile's normal data
location. Set `ZOTERO_PLUGIN_DATA_DIR` to select the data folder. Set
`ZOTERO_PLUGIN_DEVTOOLS=false` to suppress the debugger window. The
runner's `scripts/dev-server/runner.ts` defines the RDP preferences
and requires a local connection.

The current watch entry point is
`pnpm --filter @zotlit/zotero dev`. Zotero 9 and 10 are supported.

Common executable paths are
`/Applications/Zotero.app/Contents/MacOS/zotero` on macOS,
`/opt/zotero/zotero` on Linux, and
`C:/Program Files/Zotero/zotero.exe` on Windows.
An existing macOS development profile can be under
`~/Zotero/Profiles/<random>.zotlit-dev`.

A detached Paired Zotero installs the development build through a profile extension proxy. Zotero records it in the profile's extension index, which the Obsidian plugin reads to detect an installed Companion. A temporary add-on can run the same bundle without appearing in that index. The launcher waits for Companion startup and confirms the add-on before handing back the process id and its debugger port. Consumers use that port for the paired instance. The local capture server stands in for the notification listener so development checks can observe sent events.

### Paired test environment

A Paired Run owns its Fixture, seeded vault, and Zotero process.
Use its name to keep different run kinds on separate paths. Before
setup, clear a leftover registration, folders, and process only
for that run. Identify Zotero by the file handle on the run's own
Fixture database. Create the unregistered vault from that Fixture,
which sets the profile and Local API port. Zotero reads the port
at startup. Wait for its API and seed remembered Write
Authorization. Keep launch and disposal ownership in global setup,
before collection.

[Paired environment](../../packages/e2e/src/paired-environment.ts) ·
[Global setup](../../packages/e2e/src/paired-setup.ts)

The Paired Run captures setup before collection and disposes its
own Fixture, vault, and Zotero process afterward. Skip when
desktop Obsidian is unreachable, before loading the generated
dev message facade. Prepare windows for background animation
frames because the run rarely shows them.

[Paired Run](../../packages/e2e/src/paired-run.e2e.ts)

The paired PDF digest reads the copy inside the run's vault.
Its Fixture links the Attachment with a vault-rooted path.

[Paired PDF digest](../../packages/e2e/src/paired-run.e2e.ts)

### Fixture launches and reports

Use the pinned Zotero build to fix the Fixture's schema era. Resolve
`ZOTERO_APP` first, or download the managed application into a staging
directory and rename it into the cache after success. On macOS use the
system disk-image and copy tools to preserve symlinks, attributes, and
signing data. Verify the pinned Better BibTeX add-on before installing it.
Preserve native Citation Keys. Seed preferences that suppress first-run
browser, guidance, sync, add-on, and backup prompts. Keep automatic updates
off so the schema pin holds. Permit Obsidian links in the disposable
Fixture profile so a backlink smoke test reaches the vault without a
confirmation dialog. Use a separate process so Zotero cannot forward the
command line to the personal profile.

Allow standalone launches to detach and a development session to retain
its child for signaling. For each Paired Run allocate distinct loopback
ports for Live Updates and Zotero HTTP. Put them into configuration before
the servers start. The Local API is opt-in and reads its port at Zotero
startup. Reuse the current Vault Case when none is requested. Pass that
case to the dev build so hot reload updates the right vault. On Windows
launch the pnpm shim through the command interpreter. Accept ordinary
Zotero output alongside structured development log events.

Before a rebuild, stop the processes that hold the Fixture database.
Give Zotero time to close its database after SIGTERM and use SIGKILL when
it fails to exit. A missing process at signal time means it already exited.
An exit status of 1 from the file-handle probe can mean no holder.
Write both launch paths to one report beside the Fixture. A standalone
launch still holds the database and reports its process without a
debugging port. Check the reported process's liveness before treating
it as a holder. Signal zero checks without delivering a signal.
A permission failure still proves the process exists. Missing or unreadable
reports mean there is nothing to attach to. Cleanup can remove an absent
report and removes reports left by exited processes.

The Paired Run debugger connects to Zotero's parent console and bounds
each wait. An unrelated listener may never send a root greeting, so
apply a greeting deadline. Fail pending waits when the socket closes.
The console first returns an evaluation ID and then the result packet.
Its parent console cannot transform top-level await, so the async helper
runs the body inside an async function, polls its serialized result, and
preserves both the rejection message and stack. The CLI interprets the
helper's error result as a failure.

[Launcher](../../packages/scripts/lib/fixture/paired-zotero.ts) ·
[Run state](../../packages/scripts/lib/fixture/run-state.ts) ·
[First-run behavior](https://github.com/zotero/zotero/blob/22f08d1ced/chrome/content/zotero/zoteroPane.js#L636) ·
[Zotero test profile](https://github.com/zotero/zotero/blob/22f08d1ced/test/runtests.sh#L143-L166) ·
[Update preference](https://github.com/zotero/zotero/blob/22f08d1ced/app/scripts/fetch_xulrunner#L155)

The Fixture profile points at its generated data directory and carries
the quiet first-run and Obsidian protocol preferences. Enable the
Companion's notification master switch when using Live Updates. Configure
the Companion's notify URL and the vault listener together. A remembered
Local API write grant needs a shared identity, a disposable key, and
the matching vault record in Obsidian SecretStorage. A Paired Run can
leave that record absent to exercise runtime authorization.

The Companion development client drains all complete remote debugger
packets already buffered on each receive turn.
