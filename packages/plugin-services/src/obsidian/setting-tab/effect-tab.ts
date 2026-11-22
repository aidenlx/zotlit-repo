import type { PluginSettings } from "#obsidian/settings/service.ts";
import { Cause, Context, Effect, Fiber, Scope, Stream } from "effect";
import type { FileSystem } from "effect";

import { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import type { FileManager } from "@zotlit/obsidian-kit/obsidian-file-manager.ts";
import type { Vault } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import type { Workspace } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import type { PluginHost } from "@zotlit/obsidian-kit/plugin-host.ts";
import { formatErrorMessage } from "@zotlit/obsidian-kit/toast.ts";
import { recover } from "@zotlit/plugin-kernel/effect-cause.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log-category.ts";

// oxlint-disable-next-line typescript/no-empty-object-type -- each row's owner fills it by declaration merging
export interface SettingTabServiceRegistry {}

export type SettingTabEnv =
  | SettingTab
  | Notifier
  | PluginSettings
  | PluginHost
  | Vault
  | Workspace
  | FileManager
  | FileSystem.FileSystem
  // oxlint-disable-next-line typescript/no-redundant-type-constituents -- empty until the owners merge their services in
  | SettingTabServiceRegistry[keyof SettingTabServiceRegistry];

export interface SettingTabShape {
  sync<A, E>(effect: Effect.Effect<A, E, SettingTabEnv>): A;
  run<A, E>(
    effect: Effect.Effect<A, E, SettingTabEnv>,
    label?: string,
  ): Promise<void>;
  mount<E>(
    effect: Effect.Effect<unknown, E, SettingTabEnv | Scope.Scope>,
  ): () => void;
  readonly update: Effect.Effect<void>;
}

export class SettingTab extends Context.Service<SettingTab, SettingTabShape>()(
  "zotlit/setting-tab/SettingTab",
) {}

export const makeSettingTab = Effect.fn("makeSettingTab")(function* (
  update: () => void,
) {
  const base = yield* Effect.context<
    Exclude<SettingTabEnv, SettingTab> | Scope.Scope
  >();
  const notifier = Context.get(base, Notifier);
  const onFiberStart = Fiber.runIn(Context.get(base, Scope.Scope));
  const service: SettingTabShape = {
    sync: (effect) => runSync(effect),
    run: async (effect, label) => {
      await runPromiseExit(
        effect.pipe(
          recover(
            (cause) =>
              label === undefined
                ? Effect.logWarning("A setting action failed", cause)
                : Effect.logWarning(label, cause).pipe(
                    Effect.andThen(
                      notifier.show(
                        `${label}: ${formatErrorMessage(Cause.squash(cause))}`,
                      ),
                    ),
                  ),
            Effect.void,
          ),
          withLogCategory("setting-tab"),
        ),
        { onFiberStart },
      );
    },
    mount: (effect) => {
      const fiber = runFork(
        Effect.scoped(effect).pipe(
          recover(
            (cause) =>
              Effect.logWarning("A setting row stopped updating", cause),
            Effect.void,
          ),
          withLogCategory("setting-tab"),
        ),
        { onFiberStart },
      );
      return () => fiber.interruptUnsafe();
    },
    update: Effect.sync(update),
  };
  const context = Context.add(base, SettingTab, service);
  const runSync = Effect.runSyncWith(context);
  const runFork = Effect.runForkWith(context);
  const runPromiseExit = Effect.runPromiseExitWith(context);
  return service;
});

export const paintEach = <A, E, R>(
  stream: Stream.Stream<A, E, R>,
  paint: (value: A) => void,
) => Stream.runForEach(stream, (value) => Effect.sync(() => paint(value)));
