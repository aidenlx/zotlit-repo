# @zotlit/e2e

`pnpm e2e` runs the desktop and paired Vitest projects in one disposable Run Container. It starts its own Obsidian and, for paired cases, its own Zotero. The Run Container is the one place a journey runs; Vitest started on the host stops at setup. Start Docker before running a journey. The [Fixture guide](../../docs/fixture.md) owns the vault cases and data.

## Edit a journey

1. Extend the feature’s existing journey in `src/`. Search test names to find the area file. When an addition would take an area file past about 2,000 lines, start a new area file. Use `registerEndToEndRunHooks()` for the shared Fixture. A file that opens its own vault registers `registerRunVaultGuard` for that vault.
2. From the repo root, run `pnpm e2e --project=desktop src/<area>.e2e.ts`. Add `-t '<test name>'` to iterate. Use `--project=paired` for Zotero interaction. Each paired area file sets up its own Zotero session, so it runs alone.
3. Read the evidence directory printed by the launcher. It contains `results.json`, `console.log`, failure screenshots, and `paired-startup.log` when paired setup fails. For a run started by another tool, give it a dedicated `ZOTLIT_E2E_RESULTS` directory. Concurrent runs can move the `latest` link.
4. Rerun the complete changed file after the focused case passes. The launcher copies current tracked and unignored files, including uncommitted edits, and builds the dev bundles. To watch a journey in the guest, see `pnpm e2e --help` for VNC.

### Inspect a held run

To find selectors, read state, or see why a case fails, hold the run and inspect the guest's own Obsidian and Zotero:

1. Start the focused run in the background with `ZOTLIT_E2E_HOLD=1` and a dedicated `ZOTLIT_E2E_RESULTS` directory. To explore before you write steps, select a case that reaches the workflow. The first case of a file holds right after its start-up.
2. Wait for `held.json` in that directory. It names the container and the targets to probe.
3. Probe with `docker exec <container> <command>`. The guest runs the repo scripts as the host does: `/obsidian-debug` and `/zotero-rdp-debug` give the commands. For the whole display, use `scrot`; for OS input, `xdotool`; for windows, `xwininfo`. Add `--user root` for root, or `-it` with `bash` for a shell. Write output to `/results/<name>`, the evidence directory. Read a file from the live worktree at `/source/<path>`.
4. Delete `held.json` to go on. The run holds again after each later case and then ends as usual.

`pnpm e2e --help` has the hold contract. To try a code edit, start a new run: the guest builds from the files of its start.

The nightly shards the desktop project by the file times in `timings-baseline.json`. When the shards drift apart, refresh it from the `timings.json` of each nightly shard with `pnpm --filter @zotlit/e2e timings:baseline <timings.json>...`.

Use `pnpm e2e:query` for the Query CLI cases. Ordinary e2e checks correctness and records timings. To enforce a hardware-sensitive limit, run the optional `pnpm e2e:performance` alone on the [reference MacBook](../../docs/adr/0116-e2e-timing-limits-use-a-reference-machine.md#reference-baseline).

## Page callbacks

Use `obRun` from [obsidian-cli.ts](src/obsidian-cli.ts) for page code. The callback is serialized. Pass host values as JSON arguments and return JSON data. For example:

```ts
const name = await obRun(
  run.vaultId,
  ({ app }, { path }) => app.vault.getFileByPath(path)?.basename ?? null,
  { path: notePath },
);
```

Use `obRunUntil` to wait for an observable result and name that result in `what`. Read a saved note from disk when testing its contents. Wait for indexing when the next action depends on the index.

Use the [page helpers](src/page-helpers.ts) for gestures. `page.activateLeafWindow(leaf)` represents the user switching windows. Read the active document when locating a modal. In a host run, attach the Electron debugger before sending debugger input. In the Run Container, herbstluftwm gives each new window the focus except Zotero's, so a journey works in Obsidian with Zotero in the background. Use `page.reader` for the Reader and `page.scratch` for state shared by callbacks. For embedded Query Views, use [note-query-view.ts](src/note-query-view.ts). For startup-order bugs, use [reloadWindow](src/window-reload.ts) to reload the whole vault window.

## Run Container

- **Image changes.** Refresh the Node base digest and Debian snapshot together in [the Dockerfile](container/Dockerfile). When changing an app version, update its archive checksums for both architectures. Verify the full desktop and paired projects. `pnpm e2e --image-tag` prints the identity used by the launcher and nightly cache.
- **Permissions.** Give the guest user read access to the source and write access to its evidence directory. The launcher keeps a pnpm store volume per UID. On a Linux engine with user namespace remapping, apply bind-mount permissions to the mapped identity.
- **Parallel runs.** Use one full suite at a time on the reference Mac’s 8 GiB Docker VM. For the measured 10 GiB overlap and the single-container cap comparison, see the [sizing trials](https://github.com/aidenlx/zotlit-repo/issues/197#issuecomment-7081075509). The cgroup peak in `memory-peak.bytes` includes filesystem cache.
- **Fixture plugins.** The suite uses development builds for commands such as `zotlit:library-scope`. Install the Resource Pack with `installWithoutEnabling` so ZotLit can read its entries while the Pack stays disabled.

## Docs walks

For a lesson walkthrough, capture, recording, or recut, use the [docs-walk guide](src/docs-walks/AGENTS.md).

## Host measurements

Docs walks, query measurements, and startup measurements use the host desktop under an Exclusive Hold. Enable Obsidian’s CLI on the host. Use `pnpm desktop-slot status` to diagnose admission. Exit 75 means blocked at admission. A manual session yields with exit 76. See [ADR 0077](../../docs/adr/0077-desktop-admission-is-an-exclusive-slot-plus-a-memory-gate.md) for the Paint Check, Memory Gate, and leases.

- **Query planner.** Run `pnpm --filter @zotlit/e2e measure:query` before release and after planner changes. Keep the vault window visible. Read the invocation in [query-measure.ts](src/query-measure.ts) and its report under `.scratch/query-measure/`.
- **Startup.** `pnpm --filter @zotlit/e2e measure:startup --check` measures production bundles in a separate Obsidian instance. The local release gate runs it after the container suite. For modes, profiling, and output, see [startup-measure.ts](src/startup-measure.ts).
