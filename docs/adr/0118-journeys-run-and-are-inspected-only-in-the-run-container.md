---
status: accepted
---

# Journeys run and are inspected only in the Run Container

Amends [ADR 0115](0115-the-end-to-end-run-runs-in-a-container-of-its-own.md).

ADR 0115 moved the End-to-end Run into the Run Container and kept `/obsidian-debug` on the host desktop. Agents then wrote journeys against the host's Obsidian and Zotero. Those apps differ from the guest in fonts, Mod key, Zotero version and data, so facts learned there could be wrong in the run. And a direct `vitest run` of the suite still worked on the host, through the Desktop Slot setup.

We decided that a journey runs only in its Run Container, and that an agent inspects a journey in that same Run Container:

- **No host run.** The e2e Vitest projects stop at setup outside the Run Container, with a message that names `pnpm e2e`. The Desktop Slot setup of the suite is removed. Docs walks, `measure:startup`, `measure:query`, `pnpm fixture open|dev` and `/obsidian-debug` for an ordinary plugin check keep the host desktop and its Exclusive Hold.
- **A held run.** `ZOTLIT_E2E_HOLD=1` makes the run wait after each case and its `afterEach` hooks. The run writes `held.json` to the evidence folder with the container, the vault ids and the Paired Zotero debugger port. The run continues when the file is deleted.
- **Plain `docker exec`.** The image sets the guest's working folder, `HOME`, XDG folders and `DISPLAY`, so `docker exec <container> <command>` runs as a host shell does. The repo's debug scripts run unchanged in the guest. Docker's own flags give root (`--user root`) and a shell (`-it … bash`).
- **The guest's desktop tools.** The image holds `scrot`, `xdotool` and `x11-utils`. An agent captures the whole display, Zotero and native dialogs included, and sends OS-level input that the host flow could not send without taking the developer's screen.

## Considered options

- **A launcher subcommand that wraps `docker exec`** (`pnpm e2e --exec`). It was built first and removed: it copied the guest environment in a second place and hid Docker's flags behind a new interface.
- **Published CDP and RDP ports**, so the host tools attach from outside. Obsidian's CLI uses a Unix socket, which does not cross the Docker VM boundary, and Chromium binds CDP to the guest's loopback. `docker exec` reaches all three with no published port.
- **A hold at the end of the run, in global teardown.** By then the shared run vault is removed. A hold after each case keeps the vault, the app and the Paired Zotero as the case left them.

## Consequences

- A code change needs a new run: the guest builds from the files of its start. A probe file written during a hold is read from the live worktree at `/source/<path>`.
- A held run keeps its container and memory until the file is deleted or the launcher stops.
- Root in the guest can change only the disposable container. The image still has no published port unless VNC is asked for.
