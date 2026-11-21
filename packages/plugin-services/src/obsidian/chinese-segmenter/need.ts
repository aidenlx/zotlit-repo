// What a search of Chinese text asks of the Chinese Segmenter.
import { Cause, Effect } from "effect";

import type { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import type { DeviceStorage } from "@zotlit/obsidian-kit/obsidian-device-storage.ts";

import { ChineseSegmenter } from "./service.ts";

import { packNotice } from "#obsidian/managed-binary/pack-notice.ts";

/**
 * The step a search of Chinese text runs beside its request: it learns where
 * the Segmenter stands, with one read of an installed pack that is unread,
 * and shows the Resource Pack notice when the pack gives no Segmenter. The
 * search itself continues with the browser's word segmentation. A step that
 * starts while another reads the pack does nothing.
 */
export const segmenterNeed: Effect.Effect<
  Effect.Effect<void>,
  never,
  ChineseSegmenter | DeviceStorage | Notifier
> = Effect.gen(function* () {
  const segmenter = yield* ChineseSegmenter;
  const services = yield* Effect.context<DeviceStorage | Notifier>();
  let asking = false;
  return Effect.suspend(() => {
    if (asking) return Effect.void;
    asking = true;
    return Effect.gen(function* () {
      const status = (yield* segmenter.current) ?? (yield* segmenter.check);
      yield* packNotice(status);
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          asking = false;
        }),
      ),
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.void
          : Effect.logDebug("Could not show the Resource Pack notice", cause),
      ),
      Effect.provide(services),
      Effect.withSpan("ChineseSegmenter.need"),
    );
  });
});
