import { Effect } from "effect";

import type { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import type { DeviceStorage } from "@zotlit/obsidian-kit/obsidian-device-storage.ts";
import type { PluginHost } from "@zotlit/obsidian-kit/plugin-host.ts";

import { ChineseSegmenter } from "./service.ts";

import { packNotice } from "#obsidian/managed-binary/pack-notice.ts";

export const segmenterNeed: Effect.Effect<
  Effect.Effect<void>,
  never,
  ChineseSegmenter | DeviceStorage | Notifier | PluginHost
> = Effect.map(
  Effect.context<ChineseSegmenter | DeviceStorage | Notifier | PluginHost>(),
  (services) =>
    Effect.gen(function* () {
      const segmenter = yield* ChineseSegmenter;
      const status = (yield* segmenter.current) ?? (yield* segmenter.check);
      yield* packNotice(status);
    }).pipe(Effect.provide(services), Effect.withSpan("ChineseSegmenter.need")),
);
