import { Effect, Layer } from "effect";

import { layerHostApp } from "@zotlit/obsidian-kit/__fixtures__/obsidian-host-app.ts";
import { effectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { buildRuntime } from "@zotlit/plugin-kernel/effect-layer.ts";
import { layerNoteIndex } from "@zotlit/plugin-services/obsidian/note-index/service.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";

import { layerSettings } from "./settings.ts";
import type { createTemplateHost } from "./template.ts";
import { layerTemplate, Template } from "#obsidian/template/service.ts";

import { profileRevision } from "@zotlit/obsidian-desktop/profile-revision.ts";
import { layerProfile, Profile } from "#obsidian/profile/service.ts";

export function profileOver(host: ReturnType<typeof createTemplateHost>) {
  return layerProfile(profileRevision).pipe(
    Layer.provideMerge(Layer.mergeAll(layerTemplate, layerNoteIndex)),
    Layer.provideMerge(layerSettings(host.plugin)),
    Layer.provideMerge(layerHostApp(host.app)),
  );
}

export const profileRuntimeOf = Effect.fnUntraced(function* (
  host: ReturnType<typeof createTemplateHost>,
) {
  const stack = yield* Effect.acquireDisposable(
    Effect.tryPromise(async () => new AsyncDisposableStack()),
  );
  const context = yield* Effect.context<never>();
  const runtime = buildRuntime(
    profileOver(host).pipe(Layer.provideMerge(Layer.succeedContext(context))),
    stack,
  );
  yield* Effect.promise(() => runtime.context());
  return {
    runtime,
    profile: Object.assign(runtime.runSync(Profile), {
      runtime,
      bridge: effectBridge(runtime),
    }),
    profileService: runtime.runSync(Profile),
    template: Object.assign(runtime.runSync(Template), {
      runtime,
      bridge: effectBridge(runtime),
    }),
    settings: runtime.runSync(PluginSettings),
    bridge: effectBridge(runtime),
  };
});
