type RunWindow = Window &
  typeof globalThis & {
    electronWindow: import("electron").BrowserWindow;
  };

import { installMemoryClipboard } from "./memory-clipboard.ts";
import { obRun } from "./obsidian-cli.ts";

export async function prepareRunWindow(vaultId: string): Promise<void> {
  await installMemoryClipboard(vaultId);
  const reply = await obRun(vaultId, async ({ app, page }) => {
    window.__ztRestoreBackgroundThrottling?.();
    const remote =
      require("@electron/remote") as typeof import("@electron/remote");
    const main = remote.getCurrentWebContents();
    const vaultContents = () => [
      main,
      ...remote.webContents
        .getAllWebContents()
        .filter(
          (contents) =>
            contents.opener?.top?.processId === main.mainFrame.processId &&
            contents.opener?.top?.routingId === main.mainFrame.routingId,
        ),
    ];
    const previous = main.getBackgroundThrottling();
    const apply = () => {
      for (const contents of vaultContents())
        contents.setBackgroundThrottling(false);
    };
    let focused: import("electron").WebContents | undefined;
    let focusedWin: RunWindow | undefined;
    let appliedWin: RunWindow | undefined;
    let switching = Promise.resolve();
    const open = (win: RunWindow) => !win.closed && raised.has(win);
    const emulateFocus = (win: RunWindow): Promise<void> => {
      if (!open(win)) return switching;
      focusedWin = win;
      const run = switching.then(async () => {
        if (win !== focusedWin || !open(win)) return;
        const next = (
          win.require("@electron/remote") as typeof import("@electron/remote")
        ).getCurrentWebContents();
        if (focused !== next) {
          const last = focused;
          focused = next;
          appliedWin = undefined;
          if (last && !last.isDestroyed())
            await last.debugger
              .sendCommand("Emulation.setFocusEmulationEnabled", {
                enabled: false,
              })
              .catch(() => {});
          if (!open(win)) return;
          if (!next.debugger.isAttached()) next.debugger.attach("1.3");
          await next.debugger.sendCommand(
            "Emulation.setFocusEmulationEnabled",
            { enabled: true },
          );
        }
        if (!open(win)) return;
        if (activeWindow !== win)
          win.dispatchEvent(new win.FocusEvent("focus"));
        if (win === focusedWin) appliedWin = win;
      });
      switching = run.catch(() => {});
      return run;
    };
    const raised = new Map<
      RunWindow,
      {
        focus: () => void;
        shown: RunWindow["electronWindow"];
        osFocus: () => void;
        strayFocus: () => void;
      }
    >();
    const followFocus = (win: RunWindow) => {
      if (raised.has(win)) return;
      const focus = win.focus;
      const shown = win.electronWindow;
      const strayFocus = () => {
        if (!raised.has(win) && activeWindow === win)
          window.dispatchEvent(new FocusEvent("focus"));
      };
      // oxlint-disable-next-line typescript/unbound-method -- the original method is replaced for the test and restored by identity
      raised.set(win, { focus, shown, osFocus: shown?.focus, strayFocus });
      if (win !== window) win.addEventListener("focus", strayFocus);
      win.focus = () => void emulateFocus(win);
      if (shown) shown.focus = () => void emulateFocus(win);
      win.document.hasFocus = () => win === appliedWin;
    };
    const refs = [
      app.workspace.on("window-open", (_workspaceWindow, win) => {
        apply();
        followFocus(win as RunWindow);
        const shown = (win as RunWindow).electronWindow;
        if (shown && !process.env.ZOTLIT_RUN_CONTAINER)
          shown.show = () => {
            page.showBehind(shown);
          };
      }),
      app.workspace.on("window-close", (_workspaceWindow, win) => {
        raised.delete(win as RunWindow);
        if (win === focusedWin || win === activeWindow)
          void emulateFocus(window as RunWindow);
      }),
    ];
    apply();
    followFocus(window as RunWindow);
    app.workspace.iterateAllLeaves((leaf) =>
      followFocus(leaf.getContainer().win as RunWindow),
    );
    await emulateFocus(window as RunWindow);
    let settled;
    do {
      settled = switching;
      await settled;
    } while (settled !== switching);
    window.__ztRestoreBackgroundThrottling = () => {
      for (const ref of refs) app.workspace.offref(ref);
      for (const [win, { focus, shown, osFocus, strayFocus }] of raised) {
        win.focus = focus;
        if (shown) shown.focus = osFocus;
        win.removeEventListener("focus", strayFocus);
        Reflect.deleteProperty(win.document, "hasFocus");
      }
      for (const contents of vaultContents()) {
        contents.setBackgroundThrottling(true);
        if (contents.debugger.isAttached()) contents.debugger.detach();
      }
      main.setBackgroundThrottling(previous);
      delete window.__ztRestoreBackgroundThrottling;
    };
    return String(
      vaultContents().every(
        (contents) => !contents.getBackgroundThrottling(),
      ) &&
        focusedWin!.document.hasFocus() &&
        activeWindow === focusedWin,
    );
  });
  if (reply !== "true") {
    throw new Error(
      `background throttling or focus emulation failed in ${vaultId}: ${reply}`,
    );
  }
}
