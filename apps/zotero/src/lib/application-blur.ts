import { getLogger } from "@logtape/logtape";

const logger = getLogger(["zotlit", "zotero", "application-blur"]);

export function registerApplicationBlur(callback: () => void): Disposable {
  using stack = new DisposableStack();
  const pendingChecks = new Map<number, Window>();
  const windowTeardowns = new Map<Window, () => void>();
  let windowMediatorListener: nsIWindowMediatorListener | undefined;

  stack.defer(() => {
    if (windowMediatorListener) {
      Services.wm.removeListener(windowMediatorListener);
    }
    for (const [timeout, win] of pendingChecks) win.clearTimeout(timeout);
    for (const teardown of windowTeardowns.values()) teardown();
    logger.debug("unregistered application blur detector");
  });

  const attach = (win: Window) => {
    if (windowTeardowns.has(win)) return;
    const onDeactivate = () => {
      logger.trace("scheduled deferred application blur check");
      const timeout = win.setTimeout(() => {
        pendingChecks.delete(timeout);
        if (Services.focus.activeWindow !== null) return;
        logger.debug("application blur detected");
        callback();
      }, 0);
      pendingChecks.set(timeout, win);
    };
    windowTeardowns.set(win, () =>
      win.removeEventListener("deactivate", onDeactivate),
    );
    win.addEventListener("deactivate", onDeactivate);
  };

  for (const win of Services.wm.getEnumerator(null)) {
    attach(win as Window);
  }

  windowMediatorListener = {
    onOpenWindow(xulWindow) {
      attach(xulWindow.docShell.domWindow as Window);
    },
    onCloseWindow(xulWindow) {
      const win = xulWindow.docShell.domWindow as Window;
      windowTeardowns.delete(win);
      for (const [timeout, pendingWindow] of pendingChecks) {
        if (pendingWindow === win) pendingChecks.delete(timeout);
      }
    },
  };
  Services.wm.addListener(windowMediatorListener);

  logger.debug("registered application blur detector");
  return stack.move();
}
