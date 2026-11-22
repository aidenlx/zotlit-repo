import { debounce } from "@std/async";

import { registerApplicationBlur } from "@/lib/application-blur.ts";
import { logger as appLogger } from "@/lib/logger.ts";
import { prefs } from "@/prefs/index.ts";

import type { Send } from "./send.ts";

const logger = appLogger.getChild(["notify", "freshness"]);

const DEBOUNCE_MS = 500;
const MAX_WAIT_MS = 10_000;

const TRIGGER_TYPES: _ZoteroTypes.Notifier.Type[] = [
  "item",
  "item-tag",
  "tag",
  "collection",
  "collection-item",
  "trash",
  "group",
];

export type WalCheckpointStatus =
  | {
      active: true;
      automaticEnabled: boolean;
      lastRun: { at: Date; result: "done" | "failed" } | null;
    }
  | {
      active: false;
      reason: "not-wal" | "probe-failed";
      lastRun: null;
    };

export type ManualCheckpointOutcome =
  | "done"
  | "in-use"
  | "failed"
  | "unavailable";

export interface WalCheckpoint extends Disposable {
  status(): WalCheckpointStatus;
  writeNow(): Promise<ManualCheckpointOutcome>;
  onChange(listener: () => void): () => void;
}

export async function registerFreshness(send: Send): Promise<WalCheckpoint> {
  let inactiveReason: "not-wal" | "probe-failed" | undefined;
  try {
    const rows = await Zotero.DB.queryAsync("PRAGMA journal_mode");
    const mode: unknown = rows?.[0]?.journal_mode;
    if (mode !== "wal") {
      inactiveReason = "not-wal";
      logger.debug("journal mode is not wal, checkpoints inactive", {
        journalMode: mode,
      });
    }
  } catch (error) {
    inactiveReason = "probe-failed";
    logger.warning("journal mode probe failed, checkpoints inactive", {
      error,
    });
  }

  let disposed = false;
  let lastRun: { at: Date; result: "done" | "failed" } | null = null;
  const listeners = new Set<() => void>();
  const emitChange = () => {
    for (const listener of listeners) {
      try {
        listener();
      } catch (error) {
        logger.warning("wal checkpoint status listener failed", { error });
      }
    }
  };

  const signal = () => {
    void send({ event: "db/updated" });
  };

  const checkpoint = async () => {
    if (prefs.get<boolean>("extensions.zotlit.wal-checkpoint") === false) {
      logger.debug("wal checkpoint skipped, preference is off", {
        pref: "extensions.zotlit.wal-checkpoint",
      });
      return;
    }
    try {
      const rows = await Zotero.DB.queryAsync("PRAGMA wal_checkpoint(PASSIVE)");
      const row = rows?.[0];
      logger.debug("wal checkpoint done", {
        busy: row?.busy,
        log: row?.log,
        checkpointed: row?.checkpointed,
      });
      lastRun = { at: new Date(), result: "done" };
    } catch (error) {
      logger.warning("wal checkpoint failed", { error });
      lastRun = { at: new Date(), result: "failed" };
    }
    emitChange();
  };

  const writeNow = async (): Promise<ManualCheckpointOutcome> => {
    if (inactiveReason !== undefined) return "unavailable";
    let outcome: ManualCheckpointOutcome;
    try {
      const rows = await Zotero.DB.queryAsync(
        "PRAGMA wal_checkpoint(TRUNCATE)",
      );
      outcome = rows?.[0]?.busy ? "in-use" : "done";
      if (outcome === "done") lastRun = { at: new Date(), result: "done" };
      logger.debug("manual wal checkpoint finished", { outcome });
    } catch (error) {
      outcome = "failed";
      lastRun = { at: new Date(), result: "failed" };
      logger.warning("manual wal checkpoint failed", { error });
    }
    emitChange();
    if (outcome !== "failed") signal();
    return outcome;
  };

  const runPipeline = async () => {
    if (inactiveReason === undefined) await checkpoint();
    if (disposed) return;
    signal();
  };

  type Timer = ReturnType<typeof setTimeout>;
  let maxWaitTimer: Timer | undefined;

  const clearMaxWait = () => {
    if (maxWaitTimer !== undefined) clearTimeout(maxWaitTimer);
    maxWaitTimer = undefined;
  };

  const pipelineDebounced = debounce(() => {
    clearMaxWait();
    void runPipeline();
  }, DEBOUNCE_MS);

  const cancel = () => {
    pipelineDebounced.clear();
    clearMaxWait();
  };

  const observer: { notify: _ZoteroTypes.Notifier.Notify } = {
    notify() {
      pipelineDebounced();
      const maxWaitArmed = maxWaitTimer === undefined;
      maxWaitTimer ??= setTimeout(() => pipelineDebounced.flush(), MAX_WAIT_MS);
      logger.trace("freshness debounce timer {action}", {
        action: maxWaitArmed ? "started" : "reset",
        debounceMs: DEBOUNCE_MS,
        maxWaitArmed,
        maxWaitMs: MAX_WAIT_MS,
      });
    },
  };

  using stack = new DisposableStack();
  stack.defer(() => logger.debug("unregistered freshness pipeline"));
  stack.defer(cancel);
  stack.use(
    registerApplicationBlur(() => {
      const accelerated = pipelineDebounced.pending;
      pipelineDebounced.flush();
      if (accelerated) {
        logger.debug("accelerated freshness pipeline on application blur");
      }
    }),
  );

  const id = Zotero.Notifier.registerObserver(
    observer,
    TRIGGER_TYPES,
    "zotlit-notify-freshness",
  );
  stack.defer(() => Zotero.Notifier.unregisterObserver(id));
  logger.debug("registered freshness pipeline", { id });
  const disposable = stack.move();
  return {
    status: () =>
      inactiveReason !== undefined
        ? { active: false, reason: inactiveReason, lastRun: null }
        : {
            active: true,
            automaticEnabled:
              prefs.get<boolean>("extensions.zotlit.wal-checkpoint") !== false,
            lastRun:
              lastRun === null
                ? null
                : { at: new Date(lastRun.at), result: lastRun.result },
          },
    writeNow,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    [Symbol.dispose]() {
      disposed = true;
      listeners.clear();
      disposable[Symbol.dispose]();
    },
  };
}
