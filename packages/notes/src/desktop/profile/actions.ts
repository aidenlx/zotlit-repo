// Profile import has one shared UI entry from the command palette.
import { Effect, Layer } from "effect";

import { PluginHost } from "@zotlit/obsidian-kit/plugin-host.ts";
import { scopedBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import { importProfileDialog } from "./dialogs.ts";
import type { ProfileDialogServices } from "./dialogs.ts";

/**
 * Register Import profile. The import dialog runs on the layer's Scope and
 * reports its own outcome; unload closes a dialog still open.
 */
export const layerProfileActions: Layer.Layer<
  never,
  never,
  PluginHost | ProfileDialogServices
> = Layer.effectDiscard(
  Effect.gen(function* () {
    const host = yield* PluginHost;
    const bridge = yield* scopedBridge;
    const context = yield* Effect.context<ProfileDialogServices>();
    yield* host.addCommand({
      id: "import-profile",
      name: m.command_import_profile_name(),
      callback: () =>
        bridge.runAndForget(
          Effect.provideContext(importProfileDialog(host.app), context),
        ),
    });
  }),
);
