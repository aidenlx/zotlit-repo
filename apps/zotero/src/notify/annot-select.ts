import { logger as appLogger } from "@/lib/logger.ts";

import type { Send } from "./send.ts";
import { currentSelection, notifyEnabled } from "./shared.ts";

const logger = appLogger.getChild(["notify", "annot-select"]);

type InternalReader = _ZoteroTypes.ReaderInstance["_internalReader"];

interface Hook {
  internal: InternalReader;
  original: InternalReader["_updateState"];
  libraryID: number;
  lastSig: string;
}

export function registerAnnotSelectNotify(send: Send): Disposable {
  const hooks = new Map<_ZoteroTypes.ReaderInstance, Hook>();
  const hooking = new Set<_ZoteroTypes.ReaderInstance>();

  const flush = (reader: _ZoteroTypes.ReaderInstance) => {
    if (!notifyEnabled()) return;
    const hook = hooks.get(reader);
    if (!hook) return;
    const selected = currentSelection(reader, hook.libraryID);
    const sig = selected.join(",");
    if (sig === hook.lastSig) return;
    hook.lastSig = sig;
    const attachmentID = reader.itemID;
    if (typeof attachmentID !== "number") return;
    const itemID = Zotero.Items.get(attachmentID)?.parentItemID;
    if (typeof itemID !== "number") return;
    logger.debug("annot selection changed", {
      itemID,
      attachmentID,
      count: selected.length,
    });
    void send({
      event: "reader/annot-select",
      itemID,
      attachmentID,
      selected,
    });
  };

  async function hookReader(
    reader: _ZoteroTypes.ReaderInstance,
  ): Promise<void> {
    if (hooking.has(reader)) return;
    hooking.add(reader);
    try {
      await reader._initPromise;
      const internal = reader._internalReader;
      const attachmentID = reader.itemID;
      if (!internal || typeof attachmentID !== "number") return;
      const prev = hooks.get(reader);
      if (prev?.internal === internal) return;
      if (prev) prev.internal._updateState = prev.original;

      const libraryID = Zotero.Items.get(attachmentID)?.libraryID;
      if (typeof libraryID !== "number") return;

      // oxlint-disable-next-line typescript/unbound-method
      const original = internal._updateState;
      internal._updateState = function (this: InternalReader, ...args) {
        const ret = original.call(this, ...args);
        try {
          flush(reader);
        } catch (error) {
          logger.error("annot-select flush failed", { attachmentID, error });
        }
        return ret;
      };
      hooks.set(reader, {
        internal,
        original,
        libraryID,
        lastSig: currentSelection(reader, libraryID).join(","),
      });
      logger.debug("hooked reader for annot select", { attachmentID });
    } finally {
      hooking.delete(reader);
    }
  }

  function sweep(): void {
    for (const reader of Zotero.Reader._readers) void hookReader(reader);
  }

  const observer: { notify: _ZoteroTypes.Notifier.Notify } = {
    notify(_event, type) {
      if (type === "tab") sweep();
    },
  };
  const notifierID = Zotero.Notifier.registerObserver(
    observer,
    ["tab"],
    "zotlit-notify-annot-select",
  );
  sweep();
  logger.debug("registered annot-select notifier", { id: notifierID });

  return {
    [Symbol.dispose]() {
      Zotero.Notifier.unregisterObserver(notifierID);
      for (const { internal, original } of hooks.values())
        internal._updateState = original;
      hooks.clear();
      logger.debug("unregistered annot-select notifier");
    },
  };
}
