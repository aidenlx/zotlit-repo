import { Cause, Context, Effect, Exit, Layer, Queue, Scope } from "effect";
import { onTestFinished } from "vitest";

import { testNotifier } from "@zotlit/obsidian-kit/__fixtures__/notifier.ts";
import { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import { PluginHost } from "@zotlit/obsidian-kit/plugin-host.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";

import { makeSettingTab } from "#obsidian/setting-tab/effect-tab.ts";
import type { SettingTab, SettingTabEnv, SettingTabShape } from "#obsidian/setting-tab/effect-tab.ts";

export type UnimplementedTabServices = Exclude<SettingTabEnv, SettingTab | Notifier>;

export function settingTabHarness(
  unimplemented: Layer.Layer<UnimplementedTabServices>,
) {
  const scopedSettingTab = Effect.fnUntraced(function* (
    services: Context.Context<never> = Context.empty(),
    { update = () => {} }: { update?: () => void } = {},
  ) {
    const notifier = testNotifier();
    const tab: SettingTabShape = yield* makeSettingTab(update).pipe(
      Effect.provideContext(services),
      Effect.provideService(Notifier, notifier.service),
      Effect.provide(unimplemented),
    );
    return { tab, notices: notifier.notices };
  });

  const rebuildingSettingTab = Effect.fnUntraced(function* (
    layer: Layer.Layer<never>,
    { close = () => {} }: { close?: () => void } = {},
  ) {
    const services = yield* Layer.build(
      Layer.merge(
        layer,
        Layer.succeed(
          PluginHost,
          stubService<PluginHost["Service"]>("PluginHost", {
            closeSettings: Effect.sync(close),
          }),
        ),
      ),
    );
    const rebuilt = yield* Queue.unbounded<void>();
    const { tab, notices } = yield* scopedSettingTab(services, {
      update: () => Queue.offerUnsafe(rebuilt, undefined),
    });
    return { tab, notices, rebuilt };
  });

  function testSettingTab(...args: Parameters<typeof scopedSettingTab>) {
    const scope = Scope.makeUnsafe();
    onTestFinished(() => Effect.runPromise(Scope.close(scope, Exit.void)));
    return Effect.runSync(
      scopedSettingTab(...args).pipe(Effect.provideService(Scope.Scope, scope)),
    );
  }

  return { scopedSettingTab, rebuildingSettingTab, testSettingTab };
}

export interface RecordedRun {
  readonly exit: Exit.Exit<unknown, unknown>;
  readonly label: string | undefined;
}

export function recordingRuns(tab: SettingTabShape) {
  const runs: RecordedRun[] = [];
  const run: SettingTabShape["run"] = (effect, label) =>
    tab.run(
      effect.pipe(
        Effect.onExit((exit) => Effect.sync(() => runs.push({ exit, label }))),
      ),
      label,
    );
  return { tab: { ...tab, run }, runs: runs as readonly RecordedRun[] };
}

export const failureOf = ({ exit }: RecordedRun) =>
  Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;

