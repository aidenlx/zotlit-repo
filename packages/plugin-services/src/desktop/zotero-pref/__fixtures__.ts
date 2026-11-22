import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { Context, Effect, Layer } from "effect";
import type { PlatformError } from "effect";
import type { App } from "obsidian";

import { ObsidianApp } from "@zotlit/obsidian-kit/obsidian-app.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { buildRuntime } from "@zotlit/plugin-kernel/effect-layer.ts";

import { layerZoteroPref, ZoteroPrefFiles } from "./layer.ts";
import { zoteroProfilesRoot } from "./profile-root.ts";

import { ZoteroPref } from "#core/zotero-pref/service.ts";
import { electronAppData } from "#desktop/zotero-pref/__fixtures__/electron-app-data.ts";

export const zoteroPrefFixture = Effect.fn("zoteroPrefFixture")(function* (
  read: (
    path: string,
  ) => Effect.Effect<string, PlatformError.PlatformError> = () =>
    Effect.succeed(""),
  overrides: unknown = { profileDir: "/profile" },
  options: {
    onSave?: () => void;
    profilesRoot?: Effect.Effect<string, PlatformError.PlatformError>;
  } = {},
) {
  yield* Effect.acquireDisposable(
    Effect.sync(() => electronAppData("/app-data")),
  );
  let saved: unknown = overrides;
  const app = stubService<App>("App", {
    loadLocalStorage: () => saved,
    saveLocalStorage: (_key: string, value: unknown) => {
      saved = value;
      options.onSave?.();
    },
  });
  const layer = layerZoteroPref.pipe(
    Layer.provide(Layer.succeed(ObsidianApp, app)),
    Layer.provide(
      Layer.succeed(ZoteroPrefFiles, {
        read,
        profilesRoot:
          options.profilesRoot ??
          zoteroProfilesRoot.pipe(Effect.provide(NodeFileSystem.layer)),
      }),
    ),
  );
  const context = yield* Effect.context<never>();
  const { runtime } = yield* Effect.acquireRelease(
    Effect.promise(() =>
      scopedRuntime(
        layer.pipe(Layer.provideMerge(Layer.succeedContext(context))),
      ),
    ),
    (resource) => Effect.promise(() => resource.close()),
  );
  const pref = Context.get(yield* runtime.contextEffect, ZoteroPref);
  return { pref, runtime, saved: () => saved };
});

async function scopedRuntime(layer: Layer.Layer<ZoteroPref>) {
  const stack = new AsyncDisposableStack();
  const runtime = buildRuntime(layer, stack);
  await runtime.context();
  return { runtime, close: () => stack.disposeAsync() };
}
