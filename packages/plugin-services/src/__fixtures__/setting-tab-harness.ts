// The tab service over a test's own services, for row builders and the tab
// class. `settingTabHarness` binds the helpers to the services a program's tab
// reads: each package's tests pass the stand-ins of their own program, since
// a host's program registers more services than any one package does.
import { Cause, Context, Effect, Exit, Layer, Queue, Scope } from "effect";
import { onTestFinished } from "vitest";

import { testNotifier } from "@zotlit/obsidian-kit/__fixtures__/notifier.ts";
import { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import { PluginHost } from "@zotlit/obsidian-kit/plugin-host.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";

import { makeSettingTab } from "#obsidian/setting-tab/effect-tab.ts";
import type { SettingTab, SettingTabEnv, SettingTabShape } from "#obsidian/setting-tab/effect-tab.ts";

/** The services a tab reads, but its own service and the recording Notifier. */
export type UnimplementedTabServices = Exclude<SettingTabEnv, SettingTab | Notifier>;

/**
 * The tab helpers over `unimplemented`, every service the tab reads with no
 * member implemented: a test's own services replace these, and a member no
 * test gave fails that Effect with an unimplemented defect.
 */
export function settingTabHarness(
  unimplemented: Layer.Layer<UnimplementedTabServices>,
) {
  /**
   * A tab service whose Effects read `services`, with a recording Notifier
   * unless `services` brings one. Its fibers run in the current Scope, on the
   * current clock: under `it.effect`, TestClock drives a row's timers.
   */
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

  /**
   * `scopedSettingTab` over the services `layer` builds, for a row whose
   * actions rebuild the tab or leave the settings window. `rebuilt` takes one
   * element per definition rebuild an action asks for; the settings window
   * closes through `close`.
   */
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

  /** `scopedSettingTab` for a plain test: its fibers end when the test finishes. */
  function testSettingTab(...args: Parameters<typeof scopedSettingTab>) {
    const scope = Scope.makeUnsafe();
    onTestFinished(() => Effect.runPromise(Scope.close(scope, Exit.void)));
    return Effect.runSync(
      scopedSettingTab(...args).pipe(Effect.provideService(Scope.Scope, scope)),
    );
  }

  return { scopedSettingTab, rebuildingSettingTab, testSettingTab };
}

/** A handler Effect that `run` received: how it ended, and its label. */
export interface RecordedRun {
  readonly exit: Exit.Exit<unknown, unknown>;
  readonly label: string | undefined;
}

/**
 * `tab` with a `run` that also records each handler's Exit and label, for a
 * row test that tells a failed action from a done one. The label's notice is
 * `run`'s own behavior, which effect-tab.test.ts covers.
 */
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

/** The error a recorded run failed with, or `undefined` when it succeeded. */
export const failureOf = ({ exit }: RecordedRun) =>
  Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;

