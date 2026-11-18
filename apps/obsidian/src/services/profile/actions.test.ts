import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import type { App } from "obsidian";
import { expect } from "vitest";

import { testPluginHost } from "@/lib/__fixtures__/plugin-host.ts";
import { stubService } from "@/lib/__fixtures__/service-stub.ts";
import * as m from "@/lib/i18n/generated/messages.ts";
import { unimplementedProfileDialogServices } from "@/setting-tab/__fixtures__.ts";

import { layerProfileActions } from "./actions.ts";

it.effect("registers Import profile while the layer is up", () =>
  Effect.gen(function* () {
    const host = testPluginHost({ app: stubService<App>("App", {}) });
    yield* Layer.build(
      layerProfileActions.pipe(
        Layer.provide(
          Layer.merge(host.layer, unimplementedProfileDialogServices),
        ),
      ),
    );
    expect(host.commands.get("import-profile")?.name).toBe(
      m.command_import_profile_name(),
    );
  }),
);
