import { Effect, Layer } from "effect";

import type { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import { withProgress } from "@zotlit/obsidian-kit/notifier.ts";
import { PluginHost } from "@zotlit/obsidian-kit/plugin-host.ts";
import { exitOver, scopedBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import { LibrarySource } from "./service.ts";

export const layerLibrarySourceActions: Layer.Layer<
  never,
  never,
  PluginHost | Notifier | LibrarySource
> = Layer.effectDiscard(
  Effect.gen(function* () {
    const source = yield* LibrarySource;
    if (source.active !== "web-api") return;
    const host = yield* PluginHost;
    const run = exitOver(
      yield* scopedBridge,
      yield* Effect.context<Notifier>(),
    );
    const sync = withProgress(source.syncNow, {
      loading: m.notice_online_syncing(),
      success: m.notice_online_synced(),
      error: m.notice_online_sync_failed(),
    });
    yield* host.addCommand({
      id: "sync-online-library",
      name: m.command_sync_online_library_name(),
      callback: async () => {
        await run(sync);
      },
    });
  }),
);
