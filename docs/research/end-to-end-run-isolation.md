# An isolated environment for each End-to-end Run

Research note, 2026-11-22. Question: how can each End-to-end Run get its own Obsidian, its own Zotero, its own display and its own filesystem, without the macOS desktop?

Scope (from the maintainer): the isolation layer is a container or a small VM, and a light solution is preferred. The isolation must work in both directions:

- **H1, no effect on the host:** no host window, no keyboard or focus taken, no real input that reaches the host, no need for an awake or unlocked host display.
- **H2, no effect from the host on results:** host focus, display sleep, screen lock, the user's own Obsidian or Zotero, host fonts, clipboard, notifications and Mac memory pressure do not change a test result.

How to read the sources:

- "Repo:" is a file in this worktree.
- "Local probe:" is a read-only check made for this note on the M4 Pro / 12-core / 24 GB / Darwin 27 host. No app was launched.
- "(WebFetch summary)" is a paraphrase of the page by a small model. The quotes in it are as it returned them.
- "Vendor-stated" is a number the project gives for itself.
- "Not measured" means no source and no probe.
- "Unverified" means no primary source was found.

## TL;DR

- **Main finding.** The source code shows that Obsidian can run as many separate instances on one machine, and each instance can have its own CLI socket:
  - Electron scopes the single-instance lock to the user data directory (`--user-data-dir`).
  - Obsidian 1.15.1 puts its CLI socket in `$XDG_RUNTIME_DIR` on Linux and in the home directory on macOS.
  - So the suite can keep its CLI-socket transport inside each environment, and it needs no WebDriver.
  - No run confirms this yet (probe 2).
- **Ranking of the light options.** The ranking uses host non-interference first, then the same image on Linux CI, then the cost.
  1. **An OCI container with Xvfb and a small window manager** (recommended). Inside it: the pinned Obsidian 1.15.1 and Zotero 10.0 Linux arm64/x64 builds, and the whole `pnpm e2e` with its own `pnpm install`.
     - On the Mac it runs on Apple `container`, which gives one VM per container and the strongest H1/H2. OrbStack or Docker Desktop also work, as one shared VM with less memory per run.
     - On CI it runs as the same image on GitHub `ubuntu-24.04-arm`, under Docker or rootless Podman.
  2. **Podman.** It runs the same image: rootless on Linux, `podman machine` (libkrun) on the Mac. Use it where Docker Desktop or OrbStack licences are a problem.
  3. **Tart Linux VM.** Its Linux VMs can be suspended, which gives a warm start. But it is a VM disk, not the CI image, so you maintain two artifacts.
  4. **microVMs (Firecracker, Cloud Hypervisor).** Fastest start and real snapshots, but on Linux/KVM hosts only. They are not an option on the Mac. libkrun/krunvm sit under Podman on the Mac and add nothing on their own.
- **Host non-interference in a container or VM.**
  - Guaranteed: H1 in full. The display is an Xvfb inside the guest, and input is synthetic inside the guest. Also guaranteed from H2: focus, display sleep, screen lock, the user's Obsidian and Zotero, the host clipboard, notifications and host fonts.
  - Leaks: the CPU and memory contention between runs and with the host. On the Mac, host memory pressure reaches the VM as swap. Also host system sleep, which pauses the VM (unverified), and bind-mount file events, if the vault sits on a mount.
- **What goes away:** the macOS Paint Check, `caffeinate -d`, the Desktop Slot as an exclusion (it becomes a capacity limit), the vault-registry mutex, the shared `pdfjs.sidebarView` pin, and the "open behind other apps" window code. The `screencapture` / System Events shots in docs walks can move to an in-guest capture.
- **Prior art covers each part, but no tool covers the pair.**
  - wdio-obsidian-service runs pinned Obsidian instances in parallel with temporary `--user-data-dir`s under Xvfb and herbstluftwm, on Ubuntu x64 and arm64 CI.
  - Zotero CI and zotero-plugin-scaffold run Zotero under Xvfb with a temporary profile.
  - No tool runs Obsidian and Zotero together.
- **Playwright `_electron` and the wdio-electron main-process bridge do not work with Obsidian.** Obsidian 1.15.1 disables the `EnableNodeCliInspectArguments` fuse, on macOS and on Linux (local probe). The CLI socket and `--remote-debugging-port` CDP are not affected.
- **Main open risk:** no source shows that the PDF canvas paints the same under Xvfb with software rendering and no GPU. The cases that read painted PDF pages depend on it (probe 1). Other risks:
  - Linux fonts can move the coordinates and pixels that the tests check.
  - Memory per run (Obsidian + Zotero + Vitest) on a 24 GB Mac.
  - Apple `container`'s default of 1 GB RAM per VM, and memory that the VM does not give back to the host.

## Current setup (what the suite depends on today)

| Part             | How it works now                                                                                                                                                        | Host-desktop bound?                        | Source                                                                                                                                                                               |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Obsidian         | One user-launched desktop Obsidian. The suite attaches through the CLI socket and never starts Obsidian.                                                                | Yes (the developer's app)                  | Repo: `packages/e2e/src/vault-script.ts` (`isObsidianReachable`), `packages/e2e/AGENTS.md` "Requirements"                                                                            |
| Version pin      | Exact `"1.15.1 (installer 1.15.1)"`; a mismatch fails before Fixture setup                                                                                              | No                                         | Repo: `packages/e2e/src/vault-script.ts:16`                                                                                                                                          |
| CLI socket       | Windows `\\.\pipe\obsidian-cli-<user>`; else `$XDG_RUNTIME_DIR/.obsidian-cli.sock` (not on darwin) or `~/.obsidian-cli.sock`                                            | Path by OS                                 | Repo: `packages/scripts/lib/obsidian-cli.ts:117-124`; same rule in Obsidian, local probe `node_modules/.ob-rev-1.15.1/main.js:4816,5109-5112`                                        |
| Sharing          | Pool of 2 Desktop Slots, one vault each; vault-registry mutex; in-memory clipboard; app-wide `pdfjs.sidebarView` pin                                                    | Works around the one shared app            | Repo: `docs/adr/0078-desktop-slots-are-a-pool-of-n-vaults.md`, `packages/e2e/AGENTS.md` "Desktop Slot"                                                                               |
| Paint Check      | `system_profiler SPDisplaysDataType`, `ioreg IOConsoleUsers`; no probe on other OSes                                                                                    | Yes                                        | Repo: `packages/scripts/lib/desktop-paint.ts:140`                                                                                                                                    |
| Display awake    | `caffeinate -d -i -w <pid>`, darwin only                                                                                                                                | Yes                                        | Repo: `packages/scripts/lib/desktop-paint.ts:202-209`                                                                                                                                |
| Memory Gate      | macOS pressure; Linux/Windows commit ratio from `/proc/meminfo`                                                                                                         | Reads host state                           | Repo: `packages/config/memory-gate.ts:132,176,195`                                                                                                                                   |
| Paired Zotero    | Managed Zotero 10.0, started per run with `--purgecaches --new-instance --profile --dataDir --start-debugger-server=<port>`, `MOZ_NO_REMOTE=1`; ports allocated per run | Layout macOS/Windows only; throws on Linux | Repo: `packages/scripts/lib/fixture/paired-zotero.ts:36,98-162`, `apps/zotero/scripts/dev-server/runner.ts:67-72,238-247`, `packages/scripts/lib/fixture/paired-run-node.ts:123-129` |
| Window placement | `showBehind` has a darwin branch (runs in Obsidian)                                                                                                                     | Yes                                        | Repo: `packages/e2e/src/page-helpers.ts:683-700`                                                                                                                                     |
| Shortcuts        | Runner-side code picks `meta`/`control` from `process.platform`                                                                                                         | Only if runner and app differ in OS        | Repo: `packages/e2e/src/paired-reader-session.ts:304`, `packages/e2e/src/paired-mark-handles.e2e.ts:1592,1757`, `packages/e2e/src/reader.e2e.ts:1952,2115`                           |
| Links            | `zotero://` / `obsidian://` appear as strings and as staged launch links (a test plugin reads them from `localStorage`); no OS URL handler is used                      | No                                         | Local probe: `rg 'obsidian://                                                                                                                                                        | zotero://' packages/e2e/src`; Repo: `packages/e2e/src/launch-link.ts`                        |
| Dialogs          | No `showOpenDialog`/`showSaveDialog`; Zotero `commonDialog` is driven over RDP                                                                                          | No                                         | Local probe: `rg 'showOpenDialog                                                                                                                                                     | showSaveDialog' packages/e2e/src`(no hits); Repo:`packages/e2e/src/paired-zotero.ts:300-374` |
| Docs walks       | `osascript` / System Events, `screencapture`                                                                                                                            | Yes                                        | Repo: `packages/e2e/src/docs-walks/macos-desktop.ts`, `packages/e2e/src/docs-walks/docs-walk.ts`                                                                                     |

Files with a `process.platform`/`darwin` branch that a Linux port must read (local probe, `rg -l`, tests excluded):

- `apps/zotero/scripts/dev-server/runner.ts`
- `packages/e2e/src/{literature-notes.e2e,page-helpers,paired-card-selection.e2e,paired-mark-handles.e2e,paired-query.e2e,paired-reader-session,query-measure,query-view-table.e2e,reader.e2e,template-workbench.e2e,walkthrough.e2e}.ts`
- `packages/scripts/lib/{desktop-paint,obsidian-cdp,obsidian-cli,land}.ts`
- `packages/scripts/lib/fixture/{paired-run-node,paired-zotero}.ts`
- `packages/scripts/scripts/{desktop-slot,init,land-e2e,memory-gate,obsidian-vault}.ts`

## Existing solutions (the apps under test)

| Tool                                      | What it isolates                                                                                                                        | Linux headless?                                                    | Docker?                       | Maintained? Last release        | Link                                                                |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------- | ------------------------------- | ------------------------------------------------------------------- |
| wdio-obsidian-service + obsidian-launcher | Per instance: temp `--user-data-dir`, `obsidian.json` (`updateDisabled`, `cli: true`), vault copy, app asar; `maxInstances` in parallel | Yes: Xvfb + herbstluftwm on `ubuntu-latest` and `ubuntu-24.04-arm` | No                            | Yes, 3.5.0 (2026-11-01)         | https://github.com/jesse-r-s-hines/wdio-obsidian-service            |
| chhoumann/obsidian-e2e                    | Per worktree: own vault, private `HOME` (own CLI socket, `obsidian.json`), own app process; Vitest helpers over the `obsidian` CLI      | Not stated                                                         | No                            | Push 2026-11-16                 | https://github.com/chhoumann/obsidian-e2e                           |
| gpanakkal/obsidian-playwright-template    | Separate test install, fresh vault copy; Playwright                                                                                     | `xvfb-run --auto-servernum` suggested                              | No                            | Push 2026-11-15                 | https://github.com/gpanakkal/obsidian-playwright-template           |
| linuxserver/docker-obsidian               | One Obsidian per container on a Selkies web desktop; `--no-sandbox`; optional Wayland                                                   | Yes                                                                | Yes, x86_64 + aarch64         | `v1.15.1-ls153` (2026-11-15)    | https://github.com/linuxserver/docker-obsidian                      |
| zotero-plugin-scaffold                    | Temp profile + data dir; Mocha in live Zotero                                                                                           | Yes: built-in Xvfb on Ubuntu 22.04/24.04; downloads x86_64 beta    | No                            | v0.9.4 (2026-11-07)             | https://github.com/zotero-plugin-dev/zotero-plugin-scaffold         |
| Zotero `test/runtests.sh`                 | `mktemp -d` profile, `MOZ_NO_REMOTE=1 NO_EM_RESTART=1 -profile`                                                                         | Yes: `xvfb-run`, 4 shards on `ubuntu-latest`                       | `act` path installs Xvfb deps | Push 2026-11-22                 | https://github.com/zotero/zotero/blob/main/.github/workflows/ci.yml |
| linuxserver/docker-zotero                 | One Zotero per container, Selkies web desktop                                                                                           | Yes                                                                | Yes, x86_64 only              | `10.0.8-ls160` (2026-11-20)     | https://github.com/linuxserver/docker-zotero                        |
| Playwright `_electron`                    | Launches an Electron binary                                                                                                             | With Xvfb                                                          | Yes                           | v1.65.1 (2026-11-13)            | https://playwright.dev/docs/api/class-electron                      |
| wdio-electron-service                     | Chromedriver + main-process bridge                                                                                                      | WDIO v10 starts Weston or Xvfb                                     | Yes                           | in `webdriverio/desktop-mobile` | https://github.com/webdriverio/desktop-mobile                       |

Repo metadata and releases from `gh api repos/<owner>/<repo>` and `.../releases/latest`, 2026-11-22.

### Key facts about the prior art

- **Pinned Obsidian download.**
  - Obsidian ships an "installer" (the Electron executable) and an "app" (a JS asar).
  - obsidian-launcher resolves the two versions separately, from a table of every asset with its sha256 and Electron version.
  - For 1.15.1 the table lists x64 and arm64 AppImages and tarballs on Electron 43.8.9 / Chrome 150.0.7871.250.
  - Sources: https://github.com/jesse-r-s-hines/wdio-obsidian-service/blob/main/packages/obsidian-launcher/README.md, https://raw.githubusercontent.com/jesse-r-s-hines/wdio-obsidian-service/main/obsidian-versions.json
- **Sandbox.** `setupConfigDir` writes `obsidian.json` (`updateDisabled: true`, `cli: true`, vault `open: true`) and Chromium `Preferences`. It links the asar into the dir and seeds `localStorage` (`most-recently-installed-version`, `enable-plugin-<vaultId>`). `launch` spawns the installer with `--user-data-dir=<dir>`, and on Linux with `--no-sandbox` (Electron issue 42510). It works as a library or a CLI without WDIO. Source: https://github.com/jesse-r-s-hines/wdio-obsidian-service/blob/main/packages/obsidian-launcher/src/launcher.ts (lines ~930-1092)
- **CLI socket.** wdio's 3.0.0 changelog says the default CLI works "as long as you only have one Obsidian instance up at a time". `runObsidianCli` calls `window.handleCli` through WebDriver, because the socket "has a constant name". Sources: https://github.com/jesse-r-s-hines/wdio-obsidian-service/blob/main/CHANGELOG.md, https://github.com/jesse-r-s-hines/wdio-obsidian-service/blob/main/packages/wdio-obsidian-service/src/pageobjects/obsidianPage.ts
  - The file name is constant, but the directory comes from the environment (local probe, `main.js:5111`).
  - chhoumann/obsidian-e2e uses a private `HOME` so that "the CLI socket ... and `obsidian.json` registry are all scoped to that instance". Source: https://github.com/chhoumann/obsidian-e2e
  - In a container, each run has its own `XDG_RUNTIME_DIR` anyway.
- **Single-instance lock.** "The single instance lock is scoped to the application's user data directory". To run separate instances, "set a different user data directory for each instance". Source: https://www.electronjs.org/docs/latest/api/app (WebFetch summary)
- **Linux CI recipe.** `Xvfb :99 -screen 0 1280x1024x24 +extension GLX -noreset`, then `herbstluftwm`. The comment says some Obsidian features do not work without a window manager. The workflow caches `.obsidian-cache`, and macOS runners get `max-instances: 2` because they "have less RAM". Source: https://github.com/jesse-r-s-hines/wdio-obsidian-service/blob/main/.github/workflows/test.yaml
- **Packages for an image.**
  - Obsidian: `libgtk-3`, `libnss3`, `libatk*` on Debian trixie; AppImage extracted to `/opt/obsidian`; run with `--no-sandbox [--ozone-platform=wayland]`. Sources: https://github.com/linuxserver/docker-obsidian/blob/main/Dockerfile, https://github.com/linuxserver/docker-obsidian/blob/main/root/usr/bin/obsidian
  - Zotero: `xvfb dbus-x11 libgtk-3-0 libx11-xcb1 libdbus-glib-1-2 libxt6`. Source: https://github.com/zotero/zotero/blob/main/.github/workflows/ci.yml. Add `libasound2t64` on Ubuntu 24.04. Source: https://github.com/zotero-plugin-dev/zotero-plugin-scaffold/blob/main/packages/tester/src/headless.ts
- **Pinned Linux builds and their sizes.** Download sizes are not unpacked sizes.
  - Zotero 10.0: `Zotero-10.0_linux-arm64.tar.xz` (109,024,140 bytes) and `_linux-x86_64.tar.xz` (118,138,132 bytes). Local probe: `curl -I` on `https://download.zotero.org/client/release/10.0/...`.
  - Obsidian 1.15.1: `obsidian-1.15.1-arm64.tar.gz` (131,605,825 bytes). Local probe: download.
- **Fuses.** The fuse wire follows the sentinel `dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX` as one version byte, one length byte, then one ASCII `0`/`1` per fuse, in `FuseV1Options` order. Order source: https://github.com/electron/fuses/blob/main/src/config.ts
  - The macOS `Electron Framework` and the Linux arm64 `obsidian` binary of 1.15.1 both read `010000011`. So `EnableNodeCliInspectArguments` is disabled (local probe).
  - Playwright: if launch times out, make sure that fuse "is not disabled". Source: https://playwright.dev/docs/api/class-electron (WebFetch summary)
  - wdio-electron: without it, `browser.electron.execute()`/`mock()` do not work, and renderer testing works. Source: https://github.com/webdriverio/desktop-mobile/blob/main/packages/electron-service/docs/common-issues.md
- **Zotero without X.** No `MOZ_HEADLESS` use was found in a `zotero/zotero` code search. Unverified. Every source uses Xvfb.

## The light isolation candidates

### (a) OCI containers with Xvfb or headless Wayland

- **Display server.**
  - Xvfb is what every prior-art CI uses (above).
  - Weston has a `headless` backend, "useful for test suite", and a CPU-only `pixman` renderer (`-B headless`, `--renderer=pixman`). Source: https://wayland.pages.freedesktop.org/weston/toc/running-weston.html (WebFetch summary)
  - WebdriverIO v10 starts Weston before Xvfb when it is installed. Source: https://webdriver.io/docs/headless-and-display-servers (WebFetch summary)
  - Obsidian accepts `--ozone-platform=wayland` (linuxserver wrapper, above). cage or sway headless: unverified (the wlroots docs refused the fetch).
  - **Use Xvfb first.** It has the most prior art for both apps, and Zotero (Gecko/GTK) under Wayland-only is unverified.
- **Software GL.**
  - Chromium's automatic SwiftShader fallback for WebGL was removed in stages from Chrome 137-139. On Linux there is no default software WebGL fallback; `--enable-unsafe-swiftshader` opts in. Source: https://groups.google.com/a/chromium.org/g/blink-dev/c/yhFguWS_3pM (search summary of the intent thread)
  - No `webgl`/`webgpu` context was found in `packages/pdf-reader/src` or `packages/annotations/src` (local probe), and pdf.js draws with Canvas 2D. So WebGL is not expected to matter. Whether Canvas 2D output under software raster matches macOS output is the main open risk.
- **Docker hardening for Chromium.** Use `--init` and `--ipc=host` ("Without it, Chromium can run out of memory and crash"). As root the Chromium sandbox is off. Source: https://playwright.dev/docs/docker (WebFetch summary)
- **Podman.**
  - Podman 6.2.0 (2026-11-10): https://github.com/podman-container-tools/podman
  - On Linux it runs rootless, so there is no daemon and no root on a CI runner or a Linux box.
  - On the Mac it needs a VM ("Podman on MacOS and Windows requires a virtual machine"). Source: https://docs.podman.io/en/latest/markdown/podman-machine-init.1.html (WebFetch summary)
  - Podman 6 uses libkrun as the default machine provider on Apple silicon. Sources: https://github.com/containers/podman/pull/27546, https://blog.podman.io/2024/07/podman-and-libkrun/ (search summary)
- **Docker Desktop** is free for personal use and for small businesses (<250 employees and <$10M); larger use needs a subscription. Source: https://docs.docker.com/desktop/setup/install/mac-install/ (WebFetch summary). It is installed on this host, and the daemon is not running (local probe).
- **OrbStack.**
  - One "lightweight Linux virtual machine with a shared kernel"; Rosetta for x86. Source: https://docs.orbstack.dev/architecture (WebFetch summary)
  - "Starts in seconds", "less than 0.1% background CPU", "<10 MB" disk out of the box (vendor-stated). Source: https://orbstack.dev/
  - Free for personal use, $8/user/month for commercial use. "Linux graphical apps and GPU" are not supported: that means showing them on the Mac, which this design does not need. Source: https://docs.orbstack.dev/faq (WebFetch summary)

### (b) Light Linux VMs on the Mac (Virtualization.framework)

- **Apple `container` / Containerization.**
  - "Executes each Linux container inside of its own lightweight virtual machine" with "sub-second start times" (vendor-stated); Rosetta for amd64; macOS 26 and Apple silicon. Source: https://github.com/apple/containerization (WebFetch summary)
  - OCI images in and out. Virtualization.framework has "only partial support for memory ballooning", and freed guest memory is "not relinquished to the host". Source: https://github.com/apple/container/blob/main/docs/technical-overview.md (WebFetch summary)
  - Defaults: 1 GiB RAM and 4 CPUs per container (`--memory`, `--cpus`). Overcommit is allowed; past physical RAM, "macOS swaps out less-used pages". Source: https://github.com/apple/container/blob/main/docs/resource-usage.md
  - 1.7.1 (2026-11-06). Not installed on this host, which runs Darwin 27 (local probe).
  - No snapshot or checkpoint feature is documented (technical overview, above).
- **Lima (vz).** Virtualization.framework, macOS 13 or later. Source: https://lima-vm.io/docs/config/vmtype/vz/ (WebFetch summary). Its snapshot page returned 404, so snapshot support for vz is unverified. v2.3.0 (2026-11-06): https://github.com/lima-vm/lima. Colima wraps Lima, v0.10.3: https://github.com/abiosoft/colima
- **Tart (Linux guests).**
  - The repo is now `openai/tart`, 2.42.0 (2026-11-17). Licence FSL-1.1-ALv2: internal use is a Permitted Purpose. Source: https://github.com/openai/tart/blob/main/LICENSE
  - Linux guests are suspendable: `struct Linux: PlatformSuspendable`, `tart run --suspendable`, then `tart suspend`. Sources: https://github.com/openai/tart/blob/main/Sources/tart/Platform/Linux.swift, https://github.com/openai/tart/blob/main/Sources/tart/Commands/Run.swift
  - VM images live in OCI registries, but they are VM disks, not container images. Source: https://tart.run/ (WebFetch summary)
  - Clipboard sharing needs `spice-vdagent` in the guest, so the guest has none by default (`Run.swift`).
  - The 2-VM limit of Apple silicon applies to macOS guests. Sources: https://eclecticlight.co/2022/08/04/virtualisation-on-apple-silicon-macs-8-how-apple-limits-vms/, https://khronokernel.com/macos/2023/08/08/AS-VM.html (search snippets). For Linux guests the limit is unverified.

### (c) MicroVMs

- **Firecracker.**
  - `<= 125 ms` from InstanceStart to guest `/sbin/init`, and `<= 5 MiB` VMM overhead, for 1 vCPU / 128 MiB with a tuned kernel (vendor spec). Source: https://github.com/firecracker-microvm/firecracker/blob/main/SPECIFICATION.md (WebFetch summary)
  - Snapshots on x86_64 and arm64; "very fast snapshot loading"; diff snapshots are in developer preview. Source: https://github.com/firecracker-microvm/firecracker/blob/main/docs/snapshotting/snapshot-support.md (WebFetch summary)
  - No GPU or display device (README device list). Tested hosts are Amazon Linux on EC2 metal. Source: https://github.com/firecracker-microvm/firecracker (WebFetch summary)
- **Cloud Hypervisor.** "Runs on top of the KVM hypervisor and the Microsoft Hypervisor (MSHV)"; x86-64 and AArch64; snapshot/restore and live migration are guaranteed across the 2 previous major releases from v54. Source: https://github.com/cloud-hypervisor/cloud-hypervisor (WebFetch summary)
- **libkrun family.**
  - libkrun 1.19.8 uses "HVF on macOS/ARM64" and "KVM Virtualization on Linux", with virtio-gpu (venus, native-context). No snapshot is mentioned. Source: https://github.com/containers/libkrun (WebFetch summary). Repo metadata: https://github.com/libkrun/libkrun
  - krunvm 0.2.7 ("Create microVMs from OCI images"): https://github.com/libkrun/krunvm
  - krunkit 1.3.2: https://github.com/libkrun/krunkit
  - muvm 0.7.0 ("run programs from your system in a microVM", Asahi Linux): https://github.com/AsahiLinux/muvm. Use on a macOS host: unverified.
- **Snapshot of a running app, by process.** CRIU cannot dump an app connected to an X server, because "part of the app's state is in the Xserver". Source: https://criu.org/What_cannot_be_checkpointed (WebFetch summary). So a warm start needs a VM-level snapshot (Firecracker, Cloud Hypervisor, Tart suspend), not CRIU.

### Linux CI

- GitHub-hosted runners for public repos: Linux x64 and arm64 have 4 CPU / 16 GB / 14 GB SSD (`ubuntu-24.04-arm`, `ubuntu-26.04-arm`); macOS arm64 has 3 CPU / 7 GB, and nested virtualization is "not supported" there. Source: https://docs.github.com/en/actions/reference/runners/github-hosted-runners (WebFetch summary)
- This repo is public (local probe `gh api repos/aidenlx/zotlit-repo`), and `record-pr.yml` already runs on `ubuntu-latest` (Repo: `.github/workflows/record-pr.yml:32`).
- KVM on Linux runners is not stated on that page. Unverified, so Firecracker on GitHub-hosted runners is unverified.

### Dropped or shortened

- **Nix** pins packages, but it isolates no display and no filesystem.
- **Devcontainers** are the Docker row with editor wiring.
- **UTM with a desktop** and **macOS VMs** (Tart macOS, 2-VM cap) keep the macOS-bound code or are heavy. Not checked further.

## Host non-interference per candidate

H1 = no effect on the host. H2 = no host effect on results. "G" = guaranteed by the design, "L" = leaks, "?" = unverified. Each "?" has a probe below.

| Leak path                                     | Native multi-instance on macOS                                                 | Container on shared VM (OrbStack / Docker Desktop / Podman machine)      | Apple `container` (VM per container)                              | Tart Linux VM            | Rootless Podman / Docker on a Linux CI runner                     |
| --------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------ | ----------------------------------------------------------------- | ------------------------ | ----------------------------------------------------------------- |
| Host window, focus, keyboard, real input (H1) | L: windows open on the host desktop                                            | G: Xvfb inside the guest                                                 | G                                                                 | G (run headless, no VNC) | G                                                                 |
| Needs awake/unlocked display (H1)             | L: Paint Check stays                                                           | G (?: probe 9)                                                           | G (?: probe 9)                                                    | G (?: probe 9)           | G                                                                 |
| Host focus, display sleep, lock (H2)          | L                                                                              | G (?: probe 9)                                                           | G (?: probe 9)                                                    | G (?: probe 9)           | G                                                                 |
| Host system sleep / lid close                 | L                                                                              | L: the VM pauses (unverified); needs `caffeinate -i` on the host         | L, same                                                           | L, same                  | n/a                                                               |
| User's own Obsidian / Zotero (H2)             | G for Obsidian with its own user data dir and HOME; Zotero is already separate | G: separate kernel namespace                                             | G: separate VM                                                    | G                        | G                                                                 |
| Zotero Local API 23119 / RDP / CDP port clash | L: host ports, today allocated per run (`paired-run-node.ts:123-129`)          | G: own network namespace; publish no ports                               | G: own VM network                                                 | G                        | G: own netns (rootless uses slirp4netns/pasta)                    |
| CLI socket                                    | G with its own `HOME`                                                          | G: in the guest `XDG_RUNTIME_DIR`                                        | G                                                                 | G                        | G                                                                 |
| Clipboard                                     | L: OS clipboard (the suite already uses an in-memory one)                      | G: Xvfb has its own selections                                           | G                                                                 | G: no `spice-vdagent`    | G                                                                 |
| Notifications                                 | L                                                                              | G: no host notification daemon is reachable (unverified)                 | G                                                                 | G                        | G                                                                 |
| Fonts                                         | L: host fonts                                                                  | G when the image installs its fonts and nothing mounts `~/Library/Fonts` | G                                                                 | G                        | G                                                                 |
| X/Wayland socket shared with the host         | L                                                                              | G: do not mount `/tmp/.X11-unix` or `$XDG_RUNTIME_DIR`                   | G                                                                 | G                        | G                                                                 |
| GPU sharing                                   | L                                                                              | G: software only (no GPU in the guest)                                   | G                                                                 | G                        | G                                                                 |
| File events across a mount (virtiofs)         | n/a                                                                            | L/?: keep the vault on the guest filesystem; mount only the results dir  | L/?, same                                                         | L/?, same                | G: native fs                                                      |
| Memory pressure of the Mac (H2)               | L                                                                              | L: one VM, its RAM comes from the host and is swapped under pressure     | L: overcommit leads to host swap; freed guest memory not returned | L                        | L between parallel jobs on one runner; G between separate runners |
| CPU contention between runs                   | L                                                                              | L: shared VM CPUs                                                        | L: host scheduler                                                 | L                        | G per runner                                                      |

Suite features that exist only because of the host desktop, and what happens to them:

- **Paint Check** (`packages/scripts/lib/desktop-paint.ts`): goes away. It becomes an in-guest check that Xvfb runs and a test window paints a known pixel (`obsidian-cli.ts --shot --sample`).
- **`caffeinate -d`** (`desktop-paint.ts:202-209`): goes away. A Mac host may keep `caffeinate -i -w <pid>` so the Mac does not sleep and pause the VM.
- **Desktop Slot as an exclusion** (`packages/scripts/lib/desktop-slot.ts`, ADR 0077/0078): goes away. A capacity limit (the number of environments that memory allows) stays. The Exclusive Hold stays only for timing runs (`measure:query`, `measure:startup`), because CPU contention leaks in every candidate.
- **Vault-registry mutex, `stableHost`, shared `pdfjs.sidebarView` pin, the "behind other apps" window code** (`packages/scripts/lib/obsidian-vault-registry.ts`, `packages/e2e/src/vault-script.ts:60-80`, `packages/e2e/src/pdf-sidebar-pin.ts`, `packages/e2e/src/page-helpers.ts:683-700`): no longer needed, because each run has its own app.
- **Docs walk `screencapture` / System Events** (`packages/e2e/src/docs-walks/macos-desktop.ts`): can move to an in-guest capture of the Xvfb screen (for example `ffmpeg -f x11grab`; not checked). The docs walks film the macOS look, so they may stay on macOS by choice.

## Comparison of the light candidates

| Candidate                                  | Cold start                                               | Idle / per-instance memory                                      | Image or disk size                                                                     | Obsidian + Zotero paint (software GL)                | Snapshot / warm start                                                                              | ARM64 on Apple silicon              | Same image on GitHub Ubuntu ARM      | Host non-interference                                                   |
| ------------------------------------------ | -------------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------ | ----------------------------------------------------------------------- |
| Docker/OCI on OrbStack                     | "Starts in seconds" (vendor); per-container not measured | Not measured                                                    | OrbStack "<10 MB" out of the box (vendor); image not measured, apps ~240 MB compressed | Expected under Xvfb; PDF canvas unverified (probe 1) | No (image layers only; CRIU cannot dump X apps)                                                    | Yes                                 | Yes (OCI, linux/arm64)               | Strong H1; H2 leaks: memory, CPU, host sleep                            |
| Docker/OCI on Docker Desktop               | Not measured                                             | Not measured                                                    | Not measured                                                                           | Same                                                 | No                                                                                                 | Yes                                 | Yes                                  | Same as OrbStack                                                        |
| Apple `container`                          | "Sub-second" (vendor)                                    | Default 1 GiB / 4 CPU per VM; freed memory not returned to host | Not measured                                                                           | Same                                                 | No documented feature                                                                              | Yes (Apple silicon only, macOS 26+) | Yes (OCI)                            | Strongest on the Mac: VM per run; leaks: memory (swap), CPU, host sleep |
| Podman (machine on Mac, rootless on Linux) | Not measured                                             | Not measured                                                    | Not measured                                                                           | Same                                                 | `podman container checkpoint` is CRIU-based (not fetched, unverified), and CRIU cannot dump X apps | Yes (libkrun default in Podman 6)   | Yes, rootless                        | Same as OrbStack on the Mac; on Linux CI strong                         |
| Lima vz (+ Docker/nerdctl inside)          | Not measured                                             | Not measured                                                    | Not measured                                                                           | Same                                                 | vz snapshot unverified                                                                             | Yes                                 | Yes (if containers run inside)       | Same as OrbStack                                                        |
| Tart Linux VM                              | Not measured                                             | Not measured                                                    | VM disk, not measured                                                                  | Same                                                 | Yes: `--suspendable` + `tart suspend`                                                              | Yes                                 | No: VM disk, not the CI container    | Strong H1; same H2 leaks                                                |
| Firecracker / Cloud Hypervisor             | `<= 125 ms` to init (Firecracker spec, minimal guest)    | `<= 5 MiB` VMM overhead (Firecracker spec) + guest RAM          | Not measured                                                                           | Same (no GPU device)                                 | Yes (Firecracker full snapshots; Cloud Hypervisor snapshot/restore)                                | Linux/KVM hosts only, not macOS     | Needs KVM on the runner (unverified) | Strongest on a Linux host; not usable on the Mac                        |
| krunvm / libkrun direct                    | Not measured                                             | Not measured                                                    | Not measured                                                                           | Same; virtio-gpu (venus) is possible                 | Not mentioned                                                                                      | Yes (HVF)                           | Yes, as plain OCI on Linux           | Same as a VM per run; small project                                     |

## What must change in the suite

### For every candidate: the suite starts its own Obsidian

1. **Launch Obsidian per run.** Today the suite only attaches (Repo: `packages/e2e/src/vault-script.ts:23-58`). Add a launcher that:
   - installs the pinned installer and asar into a cache;
   - makes a per-run user data dir with `obsidian.json` (`cli: true`, `updateDisabled: true`, the run vault `open: true`);
   - seeds `localStorage` the way `setupConfigDir` does;
   - spawns with `--user-data-dir`, with a per-run `XDG_RUNTIME_DIR` (Linux) or `HOME` (macOS), and with `--no-sandbox` on Linux.
   - Reuse `obsidian-launcher` or copy its approach.
2. **CLI socket override.** Give `obsidianCliSocketPath()` an explicit path for the run, so the test process keeps its own `HOME` (Repo: `packages/scripts/lib/obsidian-cli.ts:117-124`).
3. **Admission.** The Desktop Slot becomes a capacity limit. Write a new ADR that supersedes the exclusion parts of ADR 0077/0078 (Repo: `packages/scripts/lib/desktop-slot.ts`, `packages/scripts/scripts/desktop-slot.ts`).
4. **Version check.** It stays as it is (Repo: `packages/e2e/src/vault-script.ts:16`).

### For the recommended container

5. **Zotero on Linux.**
   - `getManagedZoteroLayout` throws on `linux` (Repo: `packages/scripts/lib/fixture/paired-zotero.ts:153-155`).
   - `getZoteroBinary` returns the macOS path for every non-Windows OS (`:158-162`).
   - `extractApplication` uses `hdiutil`/`ditto` (`:317-334`).
   - Add the `Zotero-10.0_linux-<x86_64|arm64>.tar.xz` layout, `tar -xJf`, and the binary `Zotero_linux-<arch>/zotero`. The Linux args in `apps/zotero/scripts/dev-server/runner.ts:238-247` already fit.
   - Better: bake Zotero into the image and point `ZOTERO_APP` at it.
6. **Whole run in the guest.** `esbuild`, `workerd` and `lefthook` have native builds (Repo: `pnpm-workspace.yaml` `allowBuilds`), so the darwin `node_modules` cannot run in Linux. A unix socket on a macOS bind mount is unverified. So Vitest, the Fixture build, the CLI socket and the Zotero ports stay in the guest, with its own `pnpm install` and a named volume for the pnpm store.
   - The source tree comes in through a mount or a copy.
   - Only the results come out (Repo: `packages/e2e/src/results-dir.ts`).
7. **Vault on the guest filesystem.** Put the `.scratch/e2e-*` vaults on the guest filesystem, not on a virtiofs mount, so that file events stay native (see the leak table).
8. **Paint Check.** Replace it with an in-guest readiness check (Repo: `packages/scripts/lib/desktop-paint.ts:140-141` returns `unknown` on Linux today).
9. **Memory Gate.**
   - In the guest, `/proc/meminfo` shows the VM's memory, not the container's limit (unverified). Read `/sys/fs/cgroup/memory.max` and `memory.current` (Repo: `packages/config/memory-gate.ts:132,195`).
   - On the Mac host, keep the pressure gate before each container starts, because host pressure leaks into every candidate.
10. **Window manager and window code.** Start herbstluftwm after Xvfb. `showBehind` takes the non-darwin branch (Repo: `packages/e2e/src/page-helpers.ts:683-686`).
11. **Platform branches.**
    - Runner-side `meta`/`control` choices stay right, because the runner and the app share the guest OS.
    - Check the hard-coded `metaKey: true` events (Repo: `packages/e2e/src/reader.e2e.ts:873,1228,3337`). Some of them also set `ctrlKey`.
    - Read the other files in the platform list above.
12. **Image.**
    - Pin a Debian trixie or Ubuntu 24.04 base with a Node 26 layer (the repo pins Node 26 in `mise.toml`).
    - Add Xvfb and herbstluftwm, the Obsidian and Zotero libs listed above, and a fixed font set.
    - Bake the pinned Obsidian and Zotero by sha256.
    - Run with `--init --ipc=host` (or a large `--shm-size`) and no host mounts of X, Wayland, fonts or the clipboard. Publish no ports.
13. **Gaps against macOS results.**
    - Fonts: San Francisco and Helvetica do not exist on Linux, so UI text metrics change. Non-embedded PDF fonts fall back to the image's fonts.
    - Mod is Ctrl on Linux.
    - GTK replaces the macOS chrome.
    - Chromium runs with `--no-sandbox`.
    - The suite uses no OS dialog and no OS URL handler (see the current-setup table), so neither needs a port.

## Open questions and probes

None of these were run when this note was written. ADR 0115 chose the Run Container; its first ticket runs probes 1 and 4. Put the files in `.scratch/probe/`.

1. **Main risk: does a PDF page paint under Xvfb with no GPU, and is it the same as on macOS?**
   - Before the run, put these files in `.scratch/probe/`:
     - `ud/obsidian.json`: `{"updateDisabled":true,"cli":true,"vaults":{"p":{"path":"/probe/vault","ts":0,"open":true}}}`
     - `vault/` with one PDF and an empty `.obsidian/`
   - Command:
     ```sh
     docker run --rm --init --ipc=host \
       -v "$PWD:/repo:ro" -v "$PWD/.scratch/probe:/probe" \
       node:26-trixie bash -c '
       set -e
       apt-get update -q
       apt-get install -yq xvfb herbstluftwm libgtk-3-0 libnss3 libatk-bridge2.0-0 libgbm1 libasound2 fonts-dejavu curl
       curl -sL https://github.com/obsidianmd/obsidian-releases/releases/download/v1.15.1/obsidian-1.15.1-arm64.tar.gz | tar -xz -C /opt
       mkdir -p /tmp/rt && chmod 700 /tmp/rt
       Xvfb :99 -screen 0 1280x1024x24 -noreset & sleep 1
       DISPLAY=:99 herbstluftwm & sleep 1
       DISPLAY=:99 XDG_RUNTIME_DIR=/tmp/rt /opt/obsidian-1.15.1-arm64/obsidian --no-sandbox --user-data-dir=/probe/ud & sleep 20
       ls -la /tmp/rt
       XDG_RUNTIME_DIR=/tmp/rt node /repo/packages/scripts/scripts/obsidian-cli.ts version'
     ```
     The `node:26-trixie` tag is unverified. `obsidian-cli.ts` imports `yargs`; if the darwin `node_modules` does not resolve in the guest, copy the script's dependencies or run `pnpm install` in a copy.
   - Then open the PDF through `obsidian-cli.ts --code`, and `--shot` / `--sample` the canvas. Compare with a macOS capture of the same page.
2. **Per-instance CLI socket on macOS.** Start two Obsidians with different `--user-data-dir` and `HOME`. Run `HOME=<a> node packages/scripts/scripts/obsidian-cli.ts version` and the same for `<b>`. Expect two replies and both `<a>/.obsidian-cli.sock` and `<b>/.obsidian-cli.sock`.
3. **Cold start and memory per candidate.**
   - In the probe-1 image, measure the time from `run` until `obsidian-cli.ts version` answers, and until Paired Zotero answers its Local API.
   - Read `docker stats --no-stream` / `container stats` / `podman stats`.
   - Do it on OrbStack, Docker Desktop, Apple `container` (`container run --memory 4g ...`) and `podman machine` (libkrun). This fills the "not measured" cells.
4. **Zotero 10.0 on Linux arm64.** In the probe-1 image:
   - `curl -sL https://download.zotero.org/client/release/10.0/Zotero-10.0_linux-arm64.tar.xz | tar -xJ -C /opt` (add `xz-utils libdbus-glib-1-2 libxt6` to the apt list)
   - `DISPLAY=:99 MOZ_NO_REMOTE=1 /opt/Zotero_linux-arm64/zotero --new-instance --profile /tmp/p --dataDir /tmp/d --start-debugger-server=6100 --purgecaches &`
   - Connect with `node /repo/packages/scripts/scripts/zotero-rdp.ts`.
5. **Font exposure (no launch).** `rg -n 'getBoundingClientRect|--sample|rgb\(' packages/e2e/src | wc -l` sizes the assertions that fonts can move. A full Linux run then lists the cases that fail.
6. **Memory view in a container (no app).** Run `docker run --rm --memory=6g debian:trixie sh -c 'head -2 /proc/meminfo; cat /sys/fs/cgroup/memory.max'`.
7. **Vault watcher on a bind mount.** In the probe-1 container, open a vault on a macOS bind mount. `touch` a note from the host, and check in Obsidian whether `app.vault.on("modify")` fires.
8. **Pinned download through obsidian-launcher (no launch).** `pnpm dlx obsidian-launcher --help`, then the download subcommands from its README, into `.scratch/obsidian-cache`.
9. **H1/H2 checks.** While probe 1 runs on the Mac:
   - lock the screen, let the display sleep, and switch focus between apps;
   - also run the user's own Obsidian and Zotero;
   - confirm that the captured pixels and the test results do not change and that no window appears;
   - close the lid with no external display and check whether the VM pauses.
10. **Tart warm start.** `tart run --suspendable <linux-vm>`, start both apps, `tart suspend`, then time `tart run` back to a CLI reply.
11. **Snapshot for Lima vz.** `limactl snapshot --help` on a vz instance (the docs page returned 404).
