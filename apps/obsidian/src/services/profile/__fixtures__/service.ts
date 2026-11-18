import { Context, Effect, Layer, Stream } from "effect";
import { effectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { buildRuntime } from "@zotlit/plugin-kernel/effect-layer.ts";
import { buildLibraryScope } from "@/services/library-scope/__fixtures__.ts";
import { PluginSettings } from "@/services/settings/service.ts";
import { createTemplateHost } from "@/services/template/__fixtures__.ts";
import { Template } from "@/services/template/service.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { readsAnswering } from "@zotlit/zotero-reads/__fixtures__/reads.ts";
import type { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";

import { profileOver } from "@/services/profile/__fixtures__.ts";
import { Profile } from "@/services/profile/service.ts";

export async function profileServiceFixture(
  files: Record<string, string> = {},
  reads?: Pick<ZoteroReads["Service"], "reads" | "events">,
  context = Context.empty(),
) {
  await using stack = new AsyncDisposableStack();
  const host = createTemplateHost(files);
  const runtime = buildRuntime(profileOver(host).pipe(Layer.provideMerge(Layer.succeedContext(context))), stack);
  await runtime.context();
  const settings = runtime.runSync(PluginSettings);
  const bridge = effectBridge(runtime);
  const template = Object.assign(runtime.runSync(Template), { runtime, bridge });
  const profile = Object.assign(runtime.runSync(Profile), { runtime, bridge });
  const profileService = runtime.runSync(Profile);
  const libraryScope = await buildLibraryScope({ settings,
    reads: reads ?? stubService<ZoteroReads["Service"]>("ZoteroReads", {
      reads: readsAnswering( { Libraries: () => Effect.succeed([{ libraryID: 1, type: "user", version: 0, clientVersion: null, groupID: null, name: null }]) }),
      events: Stream.empty,
    }),
  }, stack);
  const cleanup = stack.move();
  return {
    runtime, bridge, app: host.app, vault: host.vault, settings, template, profile, profileService, libraryScope, host,
    indexNotes: () => host.metadataCache.announceAll(),
    [Symbol.asyncDispose]: () => cleanup.disposeAsync(),
  };
}
