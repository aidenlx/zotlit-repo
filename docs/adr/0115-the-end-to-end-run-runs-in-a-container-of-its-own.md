---
status: accepted
---

# The End-to-end Run runs in a container of its own

Supersedes in part ADR 0077 and ADR 0078 (the Desktop Slot pool and the sharing rules) for the End-to-end Run. Spec: [#197](https://github.com/aidenlx/zotlit-repo/issues/197). Research: [End-to-end Run isolation](../research/end-to-end-run-isolation.md).

The End-to-end Run attaches to the developer's one desktop Obsidian on macOS. So the run and the host act on each other:

- **The run affects the host.** Windows open on the developer's screen, the run needs an awake and unlocked display, and popouts and dialogs can take the focus.
- **The host affects the run.** Focus changes, display sleep, screen lock, the developer's own Obsidian and Zotero, and the load from other lanes change the results. The run after each land failed 19 of its last 25 runs.

To make two runs share one app, the suite carries workarounds: the pool of Desktop Slots, the vault-registry mutex, the in-memory clipboard, the open-behind window code, CDP focus emulation, the app-wide PDF sidebar pin, the Paint Check, and `caffeinate`. Linux CI cannot run any of it.

## Decision

Each End-to-end Run runs in one **Run Container**: a container from one OCI image, with its own display, its own Obsidian, its own Paired Zotero and its own filesystem. The same image runs on the developer's Mac (Docker Desktop, or another Docker-compatible runtime) and on a Linux CI runner.

```text
host: pnpm e2e [vitest args]
  Memory Gate (host)                 macOS pressure, or the Linux commit ratio
  docker run <image> --init          no host X, Wayland, fonts or clipboard; no published ports
    copy of the worktree             tracked + untracked-not-ignored files; node_modules stays in the guest
    pnpm install                     pnpm store in a named volume
    Xvfb :99 + herbstluftwm          a window manager, because some Obsidian features need one
    Obsidian (pinned)                --user-data-dir per run, CLI on, updates off, --no-sandbox
    Paired Zotero (pinned)           --profile and --dataDir per run, RDP inside the guest
    vitest run [vitest args]         the suite talks to Obsidian through its CLI socket, as today
  results → .scratch/e2e-results/    the one bind mount that writes to the host
```

- **The image.** It is pinned and has a fixed set of fonts. It holds the Obsidian app and installer pair and the Zotero build that the suite pins, each checked by sha256, for linux/arm64 and linux/amd64. The image tag comes from its inputs, so a change of a pinned version builds a new image.
- **The suite starts its own Obsidian.** The launcher writes a new user data folder (`obsidian.json` with the CLI on and updates off, the run vault open) and starts Obsidian with a CLI socket of the run's own. The CLI-socket transport stays. The version check stays.
- **Paired Zotero on Linux.** The managed Zotero install gets a Linux layout, or the image holds Zotero and the run points at it.
- **The vault stays on the guest filesystem.** File events stay native, and no event crosses a VM boundary.
- **Admission.** On the host, the Memory Gate admits each Run Container. Inside the container, the Memory Gate reads the container's cgroup limit. A Run Container takes no Desktop Slot and needs no Paint Check.
- **Development on the Mac.** `pnpm e2e` with a file, a test name and `--project` keeps its meaning. The evidence folder is on the host, as today. Screenshots come through CDP. A VNC port on `127.0.0.1` is available on request, to watch a run while you write a journey.
- **Linux CI.** A GitHub Actions job on `ubuntu-24.04-arm` runs the same image, at first nightly on `main` and on dispatch. It does not gate a land until it is stable.
- **The host desktop stays for the work that needs the real macOS app.** These are a docs walk that captures or records, `measure:startup`, `pnpm fixture open|dev` and `/obsidian-debug`. Each takes the whole desktop: the Desktop Slot pool shrinks to one Exclusive Hold, and the Paint Check and `caffeinate` stay for these holders only.
- **The workarounds for a shared app go.** These are the pool of N vaults, the vault-registry mutex, the open-behind window code, the app-wide sidebar pin and CDP focus emulation. Each goes only after the suite is green in the Run Container without it. A removal that changes the result of a passing case stays out.
- **The nightly is the regression net.** The run that `pnpm land` started on the Mac after each land is retired (#132), with its End-to-end Queue. A report names the failed tip; the tip of the last nightly that passed gives the range.
- **The release gate.** It runs the End-to-end Run in a Run Container. `measure:startup --check` stays on the host desktop.

## Considered options

- **Separate instances on the host** (one `--user-data-dir` and `HOME` for each run): the windows, the focus, the display and the screen lock are still the host's. This helps only with the vault registry.
- **A light Linux VM for each run** (Tart, Lima vz): each disk is a separate image from the one on CI, and a VM is heavier to start. Tart can suspend for a warm start. That is the only advantage, and the run does not need it.
- **MicroVMs** (Firecracker, Cloud Hypervisor): they need a Linux host with KVM, so they do not run on the Mac.
- **Playwright `_electron` or the WebdriverIO Electron service**: Obsidian turns off the `EnableNodeCliInspectArguments` fuse, so the main-process bridge does not connect. The CLI socket and CDP already reach the app.
- **The run outside the container, with only the apps inside**: the CLI socket would cross a VM boundary, and macOS file events would reach the guest through virtiofs. Neither is proven.

## Consequences

- The run and the host do not act on each other. No window appears on the host, and the run takes no focus or input. Display sleep, screen lock, the user's own apps, the host fonts and the host clipboard do not reach the run. CPU and memory contention still leak, and so do Mac memory pressure and system sleep.
- The Run Container is the reference for results. UI text measures with the image's fonts, and Mod is Ctrl. Cases that read coordinates or pixels get new baselines once, against the image.
- The first proof is a painted PDF page under Xvfb with software rendering. The work starts with `reader.e2e.ts` in the container, before the Paired Run and before any removal.
- Each run pays for a container start, `pnpm install` from a warm store, and the `build:dev` of the plugin bundles. Several runs on one Mac share the memory of the Docker VM.
- The nightly run on a Linux computer ([#131](https://github.com/aidenlx/zotlit-repo/issues/131)) runs the same image, so its own Xvfb, D-Bus and config-folder setup becomes the Run Container.
