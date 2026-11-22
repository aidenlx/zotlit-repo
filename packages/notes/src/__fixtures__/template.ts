import { Context, Effect, Layer } from "effect";
import type { App } from "obsidian";

import {
  layerHost,
  layerHostApp,
} from "@zotlit/obsidian-kit/__fixtures__/obsidian-host-app.ts";
import {
  createObsidianHost,
  PluginStub,
} from "@zotlit/obsidian-kit/__fixtures__/obsidian-host.ts";
import { loadedTextFileView } from "@zotlit/obsidian-kit/live-text.ts";
import { ObsidianApp } from "@zotlit/obsidian-kit/obsidian-app.ts";
import { Workspace } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import { effectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { buildRuntime } from "@zotlit/plugin-kernel/effect-layer.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";

import { layerSettings } from "./settings.ts";

import { layerTemplate, Template } from "#obsidian/template/service.ts";

export function createTemplateHost(files: Record<string, string> = {}) {
  const host = createObsidianHost(files);
  const storage = new Map<string, unknown>();
  const app = {
    ...host.app,
    loadLocalStorage: (key: string) => storage.get(key) ?? null,
    saveLocalStorage: (key: string, value: unknown) => storage.set(key, value),
    fileManager: {
      trashFile: async (file: { path: string }) =>
        host.vault.deleteFile(file.path),
    },
  } as unknown as App;
  const plugin = new PluginStub(app, {
    __VERSION__: 11,
    "template.folder": "templates",
  });
  return { ...host, app, plugin, storage };
}

export function templateOver(host: ReturnType<typeof createTemplateHost>) {
  return layerTemplate.pipe(
    Layer.provide(layerHostApp(host.app)),
    Layer.provideMerge(layerSettings(host.plugin)),
  );
}

export const templateOf = Effect.fnUntraced(function* (
  host: ReturnType<typeof createTemplateHost>,
) {
  return Context.get(yield* Layer.build(templateOver(host)), Template);
});

export function templateSettings(settings: PluginSettings["Service"]) {
  return Layer.succeed(PluginSettings, settings);
}

export async function buildTemplate(
  options: { app: App; settings: PluginSettings["Service"] },
  context = Context.empty(),
) {
  await using stack = new AsyncDisposableStack();
  const runtime = buildRuntime(
    layerTemplate.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(ObsidianApp, options.app),
          layerHost({
            vault: options.app.vault,
            fileManager: options.app.fileManager,
          }),
          Layer.mock(Workspace, {
            loadedTextView: (file) =>
              Effect.sync(() => loadedTextFileView(options.app, file)),
          }),
        ),
      ),
      Layer.provide(templateSettings(options.settings)),
      Layer.provideMerge(Layer.succeedContext(context)),
    ),
    stack,
  );
  await runtime.context();
  const service = Object.assign(runtime.runSync(Template), {
    bridge: effectBridge(runtime),
    runtime,
    templateService: runtime.runSync(Template),
  });
  const lifetime = stack.move();
  return Object.assign(service, {
    [Symbol.asyncDispose]: () => lifetime.disposeAsync(),
  });
}
