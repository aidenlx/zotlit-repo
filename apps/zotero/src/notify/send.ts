import {
  PROTOCOL_VERSION,
  PROTOCOL_VERSION_HEADER,
  SOURCE_ID_HEADER,
} from "@zotlit/protocol";
import type { NotifyEvent } from "@zotlit/protocol";

import { logger as appLogger } from "@/lib/logger.ts";

import { notifyEnabled, notifyUrl } from "./shared.ts";
import { sourceDebugDirs, sourceId } from "./source.ts";

const logger = appLogger.getChild(["notify", "send"]);

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

export type NotifyEventInput = DistributiveOmit<
  NotifyEvent,
  "profilePath" | "dataPath"
>;

export type Send = (event: NotifyEventInput) => Promise<void>;

export function createSender(): Send {
  return async function send(event) {
    if (!notifyEnabled()) return;

    const base = notifyUrl();
    if (!base) return;

    try {
      logger.info("dispatching notify event", { event: event.event, base });
      const body = JSON.stringify({
        ...event,
        ...sourceDebugDirs(),
      } satisfies NotifyEvent);
      await fetch(new URL("/notify", base), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [PROTOCOL_VERSION_HEADER]: String(PROTOCOL_VERSION),
          [SOURCE_ID_HEADER]: sourceId(),
        },
        body,
      });
      logger.debug("notified listener", { event: event.event, base });
    } catch (error) {
      logger.warn("failed to notify listener", {
        event: event.event,
        base,
        error,
      });
    }
  };
}
