import { Cause, Effect, Exit, Layer } from "effect";

import type { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import { withProgress } from "@zotlit/obsidian-kit/notifier.ts";
import { PluginHost } from "@zotlit/obsidian-kit/plugin-host.ts";
import { exitOver, scopedBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";
import { DbUnavailable } from "@zotlit/zotero-reads/contract/rpc.ts";

export const layerDatabaseActions: Layer.Layer<
  never,
  never,
  PluginHost | Notifier | ZoteroReads
> = Layer.effectDiscard(
  Effect.gen(function* () {
    const host = yield* PluginHost;
    const reads = yield* ZoteroReads;
    const run = exitOver(
      yield* scopedBridge,
      yield* Effect.context<Notifier>(),
    );
    const refresh = withProgress(reads.refresh, {
      loading: m.notice_db_refreshing(),
      success: m.notice_db_refreshed(),
      error: m.notice_db_refresh_failed(),
    });
    yield* host.addCommand({
      id: "refresh-zotero-data",
      name: m.command_refresh_db_name(),
      callback: async () => {
        const exit = await run(refresh);
        if (Exit.isSuccess(exit) || Cause.hasInterruptsOnly(exit.cause)) return;
        const error = Cause.squash(exit.cause);
        if (error instanceof DbUnavailable) return;
        throw error;
      },
    });
  }),
);
