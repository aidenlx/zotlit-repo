import { Effect, Layer } from "effect";

import { PluginHost } from "@zotlit/obsidian-kit/plugin-host.ts";
import { scopedBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import { Release } from "./service.ts";

export const layerReleaseActions: Layer.Layer<
  never,
  never,
  PluginHost | Release
> = Layer.effectDiscard(
  Effect.gen(function* () {
    const host = yield* PluginHost;
    const release = yield* Release;
    const bridge = yield* scopedBridge;
    yield* host.addCommand({
      id: "open-release-note",
      name: m.command_open_release_note_name(),
      callback: () => bridge.runAndForget(release.openReleaseNote),
    });
  }),
);
