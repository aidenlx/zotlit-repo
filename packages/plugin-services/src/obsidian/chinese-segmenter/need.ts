// What a search of Chinese text asks of the Chinese Segmenter.
import { Effect } from "effect";

import type { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import type { DeviceStorage } from "@zotlit/obsidian-kit/obsidian-device-storage.ts";
import type { PluginHost } from "@zotlit/obsidian-kit/plugin-host.ts";

import { ChineseSegmenter } from "./service.ts";

import { packNotice } from "#obsidian/managed-binary/pack-notice.ts";

/**
 * The step a search of Chinese text runs beside its request: it learns where
 * the Segmenter stands, with one read of an installed pack that is unread,
 * and shows the Resource Pack notice when the pack gives no Segmenter. The
 * search itself continues with the browser's word segmentation.
 */
export const segmenterNeed: Effect.Effect<
  Effect.Effect<void>,
  never,
  ChineseSegmenter | DeviceStorage | Notifier | PluginHost
> = Effect.gen(function* () {
  const segmenter = yield* ChineseSegmenter;
  const services = yield* Effect.context<
    DeviceStorage | Notifier | PluginHost
  >();
  return Effect.gen(function* () {
    const status = (yield* segmenter.current) ?? (yield* segmenter.check);
    yield* packNotice(status);
  }).pipe(Effect.provide(services), Effect.withSpan("ChineseSegmenter.need"));
});
