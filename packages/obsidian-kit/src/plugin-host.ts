import type { CliHost } from "#cli-command.ts";
import { Context, Effect, Layer } from "effect";
import type { Scope } from "effect";
import { around } from "monkey-around";
import type {
  Command,
  Plugin,
  PluginSettingTab,
  View,
  WorkspaceLeaf,
} from "obsidian";

export interface PluginHostShape
  extends
    Pick<
      Plugin,
      | "app"
      | "manifest"
      | "registerMarkdownPostProcessor"
      | "registerEditorExtension"
      | "registerHoverLinkSource"
      | "registerObsidianProtocolHandler"
    >,
    CliHost {
  addCommand(command: Command): Effect.Effect<Command, never, Scope.Scope>;
  onViewCreated(
    viewTypes: readonly string[],
    created: (leaf: WorkspaceLeaf, view: View) => void,
  ): Effect.Effect<boolean, never, Scope.Scope>;
  addSettingTab<T extends PluginSettingTab>(
    build: (plugin: Plugin) => T,
  ): Effect.Effect<T, never, Scope.Scope>;
  readonly closeSettings: Effect.Effect<void>;
}

export class PluginHost extends Context.Service<PluginHost, PluginHostShape>()(
  "zotlit/obsidian/PluginHost",
) {}

export function makePluginHost(plugin: Plugin & CliHost): PluginHostShape {
  return {
    get app() {
      return plugin.app;
    },
    get manifest() {
      return plugin.manifest;
    },
    registerMarkdownPostProcessor: (postProcessor, sortOrder) =>
      plugin.registerMarkdownPostProcessor(postProcessor, sortOrder),
    registerEditorExtension: (extension) =>
      plugin.registerEditorExtension(extension),
    registerHoverLinkSource: (id, info) =>
      plugin.registerHoverLinkSource(id, info),
    registerObsidianProtocolHandler: (action, handler) =>
      plugin.registerObsidianProtocolHandler(action, handler),
    registerCliCommand: (name, command) =>
      plugin.registerCliCommand(name, command),
    addCommand: Effect.fn("PluginHost.addCommand")(function* (command) {
      const id = command.id;
      return yield* Effect.acquireRelease(
        Effect.sync(() => plugin.addCommand(command)),
        () => Effect.sync(() => plugin.removeCommand(id)),
      );
    }),
    onViewCreated: Effect.fn("PluginHost.onViewCreated")(
      function* (viewTypes, created) {
        const registry = plugin.app.viewRegistry;
        if (typeof registry?.getViewCreatorByType !== "function") return false;
        yield* Effect.acquireRelease(
          Effect.sync(() =>
            around(registry, {
              getViewCreatorByType: (getCreator) => (type) => {
                const creator = getCreator.call(registry, type);
                if (!creator || !viewTypes.includes(type)) return creator;
                return (leaf) => {
                  const view = creator(leaf);
                  created(leaf, view);
                  return view;
                };
              },
            }),
          ),
          (uninstall) => Effect.sync(() => uninstall()),
        );
        return true;
      },
    ),
    addSettingTab: (build) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const tab = build(plugin);
          plugin.addSettingTab(tab);
          return tab;
        }),
        (tab) => Effect.sync(() => plugin.app.setting.removeSettingTab(tab)),
      ),
    closeSettings: Effect.sync(() => plugin.app.setting.close()),
  };
}

export const leaveSettingsFor = <A, E, R>(open: Effect.Effect<A, E, R>) =>
  PluginHost.use((host) => host.closeSettings).pipe(Effect.andThen(open));

export function layerPluginHost(
  plugin: Plugin & CliHost,
): Layer.Layer<PluginHost> {
  return Layer.succeed(PluginHost, makePluginHost(plugin));
}
