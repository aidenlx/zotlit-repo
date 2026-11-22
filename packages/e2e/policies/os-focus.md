# OS focus

Each host-desktop run takes an Exclusive Hold and passes the Memory Gate. It leaves the developer's windows on top, except while a docs walk records a step. Focus inside a vault uses CDP focus emulation, owned by `prepareRunWindow` (`src/background-throttling.ts`).

- Open a vault through `vaultScript` (`src/vault-script.ts`), which passes `--inactive` to `obsidian-vault.ts`. Its open hook turns the window's background throttling off before the page loads, so the renderer keeps normal priority while it starts behind other apps; `prepareRunWindow` keeps it off.
- Show a window with `showBehind` (`src/background-throttling.ts`): `showInactive` alone keeps the focus but puts the window in front of every app on macOS, and `showBehind` then orders it behind them. `raiseWindow` (`src/reader-gestures.ts`) brings back a hidden or minimized one. Keep window-activating calls — `BrowserWindow.show()` / `focus()` / `moveTop()`, `app.focus()` — out of the suite and its helpers. On the host, a docs walk that records is the one exception: under its Exclusive Hold, it brings Zotero to the front and hides Obsidian, and only in a step whose clip records (`packages/e2e/AGENTS.md`, "Docs walks").
- Move focus between a vault's windows through the calls `prepareRunWindow` hooks (`window.focus()`, `electronWindow.focus()`); a hook moves only the emulation.
- Read the focused window from Obsidian's `activeWindow` / `activeDocument`: a modal opens there, which can be a popout rather than the main `document`.

The Run Container uses its own Xvfb display and Obsidian process. The window manager places vault windows in the guest. The suite keeps CDP focus emulation for keyboard journeys. See [ADR 0115](../../../docs/adr/0115-the-end-to-end-run-runs-in-a-container-of-its-own.md).
