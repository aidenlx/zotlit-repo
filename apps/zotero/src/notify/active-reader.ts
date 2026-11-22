import { logger as appLogger } from "@/lib/logger.ts";

import type { Send } from "./send.ts";
import { currentSelection, notifyEnabled } from "./shared.ts";

const logger = appLogger.getChild(["notify", "active-reader"]);

const READER_WINDOW_URL = "chrome://zotero/content/reader.xhtml";
const MAIN_WINDOW_URL = "chrome://zotero/content/zoteroPane.xhtml";

type ReaderWindow = Window & { reader?: _ZoteroTypes.ReaderInstance };

export function registerActiveReaderNotify(send: Send): Disposable {
  let lastActiveAttachment: number | null = null;

  const flushInactive = () => {
    if (lastActiveAttachment === null) return;
    lastActiveAttachment = null;
    logger.debug("focused tab or window is no longer a reader");
    void send({ event: "reader/inactive" });
  };

  const flushReader = (reader: _ZoteroTypes.ReaderInstance | undefined) => {
    if (!notifyEnabled()) return;
    if (!reader) {
      flushInactive();
      return;
    }
    const attachmentID = reader.itemID;
    if (typeof attachmentID !== "number") return;
    if (attachmentID === lastActiveAttachment) return;
    lastActiveAttachment = attachmentID;
    const attachment = Zotero.Items.get(attachmentID);
    const itemID = attachment?.parentItemID;
    if (typeof itemID !== "number") return;
    const selected =
      typeof attachment?.libraryID === "number"
        ? currentSelection(reader, attachment.libraryID)
        : [];
    logger.debug("active reader changed", {
      itemID,
      attachmentID,
      selected: selected.length,
    });
    void send({
      event: "reader/active",
      itemID,
      attachmentID,
      selected,
    });
  };

  const observer: { notify: _ZoteroTypes.Notifier.Notify } = {
    notify(event, type, ids) {
      if (type !== "tab" || event !== "select") return;
      const tabID = ids[0];
      if (typeof tabID !== "string") return;
      flushReader(Zotero.Reader.getByTabID(tabID));
    },
  };
  using stack = new DisposableStack();
  stack.defer(() => logger.debug("unregistered active-reader notifier"));

  const notifierID = Zotero.Notifier.registerObserver(
    observer,
    ["tab"],
    "zotlit-notify-active-reader",
  );
  stack.defer(() => Zotero.Notifier.unregisterObserver(notifierID));

  const windowTeardowns = new WeakMap<Window, () => void>();
  let disposed = false;

  const attachReaderWindow = (win: ReaderWindow) => {
    if (windowTeardowns.has(win)) return;
    const handler = () => flushReader(win.reader);
    win.addEventListener("activate", handler);
    windowTeardowns.set(win, () =>
      win.removeEventListener("activate", handler),
    );
  };

  const attachMainWindow = (win: _ZoteroTypes.MainWindow) => {
    if (windowTeardowns.has(win)) return;
    const handler = () =>
      flushReader(Zotero.Reader.getByTabID(win.Zotero_Tabs.selectedID));
    win.addEventListener("activate", handler);
    windowTeardowns.set(win, () =>
      win.removeEventListener("activate", handler),
    );
  };

  for (const win of Services.wm.getEnumerator("zotero:reader")) {
    attachReaderWindow(win as ReaderWindow);
  }
  for (const win of Zotero.getMainWindows()) {
    attachMainWindow(win);
  }

  const windowMediatorListener: nsIWindowMediatorListener = {
    onOpenWindow(xulWindow) {
      const domWindow = xulWindow.docShell.domWindow as ReaderWindow &
        _ZoteroTypes.MainWindow;
      const onLoad = () => {
        domWindow.removeEventListener("load", onLoad);
        if (disposed) return;
        if (domWindow.location.href === READER_WINDOW_URL) {
          attachReaderWindow(domWindow);
          flushReader(domWindow.reader);
        } else if (domWindow.location.href === MAIN_WINDOW_URL) {
          attachMainWindow(domWindow);
        }
      };
      domWindow.addEventListener("load", onLoad);
    },
    onCloseWindow(xulWindow) {
      const domWindow = xulWindow.docShell.domWindow as ReaderWindow &
        _ZoteroTypes.MainWindow;
      windowTeardowns.delete(domWindow);
    },
  };
  Services.wm.addListener(windowMediatorListener);
  stack.defer(() => Services.wm.removeListener(windowMediatorListener));
  stack.defer(() => {
    disposed = true;
    for (const win of Services.wm.getEnumerator("zotero:reader"))
      windowTeardowns.get(win)?.();
    for (const win of Zotero.getMainWindows()) windowTeardowns.get(win)?.();
  });

  const startupWindow = (Services.focus.activeWindow ??
    Services.wm.getMostRecentWindow(null)) as ReaderWindow | null;
  if (startupWindow?.location.href === READER_WINDOW_URL) {
    flushReader(startupWindow.reader);
  } else {
    const mainWin = Zotero.getMainWindow();
    if (mainWin)
      flushReader(Zotero.Reader.getByTabID(mainWin.Zotero_Tabs.selectedID));
  }

  logger.debug("registered active-reader notifier", { id: notifierID });
  return stack.move();
}
