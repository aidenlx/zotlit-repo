// The settings store over a test's plugin data, for any host definition.
import { Context, Effect, Layer, Stream } from "effect";
import type { Plugin } from "obsidian";

import { testEvent } from "@zotlit/plugin-kernel/__fixtures__/event-stream.ts";
import { effectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import type { EffectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { buildRuntime } from "@zotlit/plugin-kernel/effect-layer.ts";
import type { SubscriptionRuntime } from "@zotlit/plugin-kernel/effect-stream.ts";

import type { Settings } from "#core/settings/schema.ts";
import {
  layerPluginSettings,
  PluginSettings,
} from "#obsidian/settings/service.ts";
import type { PluginSettingsOptions } from "#obsidian/settings/service.ts";

export type SettingsFixtureOptions = PluginSettingsOptions & {
  plugin: Pick<Plugin, "loadData" | "saveData">;
};

export const settingsOf = Effect.fnUntraced(function* ({
  plugin,
  ...options
}: SettingsFixtureOptions) {
  return Context.get(
    yield* Layer.build(layerPluginSettings(plugin, options)),
    PluginSettings,
  );
});

/** Writes `overrides` through the real store's `update`. */
export function applySettings(
  settings: Pick<PluginSettings["Service"], "update">,
  bridge: Pick<EffectBridge, "runSync">,
  overrides: Partial<Settings>,
): void {
  if (Object.keys(overrides).length > 0)
    bridge.runSync(settings.update(overrides));
}

/**
 * The settings service, its bridge, and its runtime, using the test's Clock and
 * logger; all three close with the test Scope.
 */
export const settingsRuntimeOf = Effect.fnUntraced(function* (
  options: SettingsFixtureOptions,
) {
  const context = yield* Effect.context<never>();
  const handle = yield* Effect.acquireRelease(
    Effect.promise(() => openSettings(options, context)),
    (handle) => Effect.promise(() => handle.close()),
  );
  return handle;
});

export type SettingsFixture = PluginSettings["Service"] &
  AsyncDisposable & {
    readonly bridge: EffectBridge;
    readonly runtime: SubscriptionRuntime;
  };

/** Consumer fixtures outside Effect own the service's runtime through this handle. */
export async function buildSettings(
  options: SettingsFixtureOptions,
): Promise<SettingsFixture> {
  const { settings, bridge, close, runtime } = await openSettings(options);
  return Object.assign(settings, {
    bridge,
    runtime,
    [Symbol.asyncDispose]: close,
  });
}

async function openSettings(
  { plugin, ...options }: SettingsFixtureOptions,
  context = Context.empty(),
) {
  await using stack = new AsyncDisposableStack();
  const layer = layerPluginSettings(plugin, options).pipe(
    Layer.provideMerge(Layer.succeedContext(context)),
  );
  const runtime = buildRuntime(layer, stack);
  await runtime.context();
  const settings = runtime.runSync(PluginSettings);
  const lifetime = stack.move();
  return {
    settings,
    bridge: effectBridge(runtime),
    runtime,
    close: () => lifetime.disposeAsync(),
  };
}

/**
 * Settings whose changes the test publishes, for a layer that reads only
 * `current` and `changes`. `changes` replays the current value to a new
 * subscriber, then each `update`. `update` returns once every subscriber's
 * runnable handling of the new value has run.
 *
 * @param defaults the host's whole map, which `overrides` replaces in part.
 */
export function settingsFeed(
  defaults: Readonly<Settings>,
  overrides: Partial<Settings> = {},
) {
  let current: Readonly<Settings> = { ...defaults, ...overrides };
  const events = testEvent<Readonly<Settings>>();
  return {
    layer: Layer.mock(PluginSettings, {
      current: Effect.sync(() => current),
      changes: Stream.suspend(() =>
        events.stream.pipe(Stream.prepend([current])),
      ),
    }),
    update(patch: Partial<Settings>): void {
      if (events.subscribers === 0)
        throw new Error("No layer follows the settings yet");
      current = { ...current, ...patch };
      events.emit(current);
    },
  };
}
