import { Layer } from "effect";
import type { Plugin } from "obsidian";

import type { CliHost } from "@zotlit/obsidian-kit/cli-command.ts";
import { layerRequestUrlHttpClient } from "@zotlit/obsidian-kit/http-client.ts";
import { layerNotifier, Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import { ObsidianApp } from "@zotlit/obsidian-kit/obsidian-app.ts";
import {
  DeviceStorage,
  layerDeviceStorage,
} from "@zotlit/obsidian-kit/obsidian-device-storage.ts";
import {
  layerObsidianEnv,
  ObsidianEnv,
} from "@zotlit/obsidian-kit/obsidian-env.ts";
import {
  FileManager,
  layerFileManager,
} from "@zotlit/obsidian-kit/obsidian-file-manager.ts";
import {
  layerMetadataCache,
  MetadataCache,
} from "@zotlit/obsidian-kit/obsidian-metadata-cache.ts";
import { layerVault, Vault } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import {
  layerWorkspace,
  Workspace,
} from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import {
  layerPluginHost,
  PluginHost,
} from "@zotlit/obsidian-kit/plugin-host.ts";
import {
  LanguagePack,
  layerLanguagePack,
} from "@zotlit/plugin-services/obsidian/language-pack/service.ts";
import type { LanguagePackStartup } from "@zotlit/plugin-services/obsidian/language-pack/service.ts";
import {
  layerLogging,
  layerLogOutput,
} from "@zotlit/plugin-services/obsidian/log/service.ts";
import {
  layerPluginSettings,
  PluginSettings,
} from "@zotlit/plugin-services/obsidian/settings/service.ts";
import type { PluginSettingsOptions } from "@zotlit/plugin-services/obsidian/settings/service.ts";

import { GraphBuilt } from "./graph-built.ts";

import { startingAs } from "#core/startup-failure.ts";

export type ShellBase =
  | PluginSettings
  | ObsidianApp
  | Notifier
  | ObsidianEnv
  | DeviceStorage
  | MetadataCache
  | FileManager
  | Workspace
  | Vault
  | PluginHost
  | LanguagePack
  | GraphBuilt;

export const shellBaseKeys: ReadonlySet<string> = new Set(
  [
    PluginSettings,
    ObsidianApp,
    Notifier,
    ObsidianEnv,
    DeviceStorage,
    MetadataCache,
    FileManager,
    Workspace,
    Vault,
    PluginHost,
    LanguagePack,
    GraphBuilt,
  ].map((tag) => tag.key),
);

export function layerShellBase(
  plugin: Plugin & CliHost,
  options: {
    readonly settings: PluginSettingsOptions;
    readonly languagePack: LanguagePackStartup;
    readonly built: Layer.Layer<GraphBuilt>;
  },
): Layer.Layer<ShellBase> {
  const fileManager = layerFileManager.pipe(Layer.provide(layerVault));
  const obsidian = Layer.mergeAll(
    layerNotifier,
    layerObsidianEnv,
    layerDeviceStorage,
    layerMetadataCache,
    fileManager,
    layerWorkspace,
    layerVault,
    layerPluginHost(plugin),
    options.built,
  ).pipe(Layer.provideMerge(Layer.succeed(ObsidianApp, plugin.app)));
  return layerLanguagePack(options.languagePack).pipe(
    Layer.provide(layerRequestUrlHttpClient),
    startingAs("LanguagePack"),
    Layer.provideMerge(obsidian),
    Layer.provideMerge(
      layerLogging.pipe(
        Layer.provide(layerLogOutput(plugin)),
        startingAs("Logging"),
      ),
    ),
    Layer.provideMerge(
      layerPluginSettings(plugin, options.settings).pipe(
        startingAs("PluginSettings"),
      ),
    ),
  );
}
