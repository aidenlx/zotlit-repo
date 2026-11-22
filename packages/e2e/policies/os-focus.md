# OS focus

- **Run Container.** Verify that window placement, keyboard focus, and input stay on the guest display. The window manager focuses new windows. When the user switches back to an existing window, the journey selects that window with `page.activateLeafWindow`. A focus check must agree with Obsidian’s active window. A journey that sends debugger input owns its debugger attachment.
- **Host desktop.** Host tools take an Exclusive Hold and open the vault through `vaultScript` with `--inactive`. Check that opening, restoring, or focusing a test window preserves the developer’s foreground app. [prepareRunWindow](../src/background-throttling.ts) owns host focus emulation and background throttling. [showBehind](../src/page-helpers.ts) restores window order on macOS.
- **Popouts.** Locate a modal in its owner’s document. Obsidian’s `activeDocument` can be a popout.
- **Recording.** Only the native step being recorded may activate a host app under the Exclusive Hold. Follow the [docs-walk instructions](../src/docs-walks/AGENTS.md).
