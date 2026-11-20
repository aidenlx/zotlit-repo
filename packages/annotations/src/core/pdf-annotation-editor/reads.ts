import { Effect } from "effect";

import {
  logServices,
  withLogCategory,
  logLevelEnabled,
} from "@zotlit/plugin-kernel/effect-log.ts";

/** A live read, retaining the Attachment and the exact instant for write-back. */
export interface PdfRead {
  attachmentKey: string;
  serverID: string | null;
  itemKey: string;
  instant: Temporal.Instant;
}

interface PdfReadsDeps {
  record: (read: PdfRead) => void;
  now: () => Temporal.Instant;
}

/** One throttle shared by every view of an Attachment in this workspace. */
export class PdfReads {
  readonly #last = new Map<string, Temporal.Instant>();
  readonly #record;
  readonly #now;

  constructor({ record, now }: PdfReadsDeps) {
    this.#record = record;
    this.#now = now;
  }

  record(
    target: {
      attachmentKey: string;
      itemKey: string | null;
      serverID: string | null;
    },
    event: "open" | "page" | "close",
    instant = this.#now(),
  ): void {
    const { attachmentKey, itemKey, serverID } = target;
    if (itemKey === null) {
      if (logLevelEnabled("trace"))
        Effect.runSyncWith(logServices)(
          Effect.logTrace("PDF read skipped").pipe(
            Effect.annotateLogs({
              attachmentKey,
              event,
              reason: "standalone",
            }),
            withLogCategory("pdf-reads"),
          ),
        );
      return;
    }
    const last = this.#last.get(`${serverID}/${attachmentKey}`);
    if (
      event === "page" &&
      last &&
      instant.epochMilliseconds - last.epochMilliseconds < 5 * 60 * 1000
    ) {
      if (logLevelEnabled("trace"))
        Effect.runSyncWith(logServices)(
          Effect.logTrace("PDF read throttled").pipe(
            Effect.annotateLogs({
              attachmentKey,
              event,
              reason: "page interval",
            }),
            withLogCategory("pdf-reads"),
          ),
        );
      return;
    }
    if (!last || Temporal.Instant.compare(instant, last) > 0)
      this.#last.set(`${serverID}/${attachmentKey}`, instant);
    if (logLevelEnabled("trace"))
      Effect.runSyncWith(logServices)(
        Effect.logTrace("PDF read accepted").pipe(
          Effect.annotateLogs({ attachmentKey, event }),
          withLogCategory("pdf-reads"),
        ),
      );
    this.#record({ attachmentKey, itemKey, serverID, instant });
  }
}
