import type { GroupNode } from "#core/graph.ts";
// A host's declaration, and what the shell derives from its features: the
// settings definition, the plugin graph, and the check that no feature reads a
// service the composition leaves out.
import { Layer } from "effect";
import type { Plugin } from "obsidian";
import * as v from "valibot";

import type { CliHost } from "@zotlit/obsidian-kit/cli-command.ts";
import { layerViewRegistry } from "@zotlit/obsidian-kit/view-atoms.ts";
import type {
  ViewRegistry,
  ViewServices,
} from "@zotlit/obsidian-kit/view-atoms.ts";
import type {
  Settings,
  SettingsDefinition,
} from "@zotlit/plugin-services/core/settings/schema.ts";
import type { LanguagePackStartup } from "@zotlit/plugin-services/obsidian/language-pack/service.ts";
import type { SettingTabEnv } from "@zotlit/plugin-services/obsidian/setting-tab/effect-tab.ts";
import type { SettingTab } from "@zotlit/plugin-services/obsidian/setting-tab/effect-tab.ts";
import type { PluginSettingsOptions } from "@zotlit/plugin-services/obsidian/settings/service.ts";

import { layerShellBase, shellBaseKeys } from "./base.ts";
import type { ShellBase } from "./base.ts";
import type {
  Feature,
  Listed,
  OpenPorts,
  ProvidesOf,
  ServiceGroup,
} from "./feature.ts";
import type { GraphBuilt } from "./graph-built.ts";
import { layerProtocolHandlers } from "./protocol.ts";
import { layerSettingTab } from "./setting-tab/layer.ts";
import type { SettingTabOrder } from "./setting-tab/tab.ts";

import { buildOrder, stackGroups } from "#core/graph.ts";
import { startingAs } from "#core/startup-failure.ts";

/** The services the shell builds above the features: the view registry. */
export type ShellProvides = ViewRegistry;

/** What the shell's own registrations read: every view service and tab service. */
type ShellReads = ViewServices | Exclude<SettingTabEnv, SettingTab>;

/**
 * The services the composition of `F` reads and fills nowhere: the features'
 * open ports, and the view and tab services that no feature fills.
 */
export type MissingServices<F extends readonly Feature<any, any, any>[]> =
  | OpenPorts<F, ShellProvides>
  | Exclude<ShellReads, ProvidesOf<F> | ShellBase | ShellProvides>;

/** A plugin host: what differs from one host to the next. */
export interface HostDeclaration<F extends readonly Feature<any, any, any>[]> {
  /** The features, in the order their services, registrations and hooks start. */
  readonly features: F;
  /** The settings definition and this plugin's `data.json` migrations. */
  readonly settings: PluginSettingsOptions;
  /** Where the setting tab places each feature's entries. */
  readonly settingTab: SettingTabOrder;
  /** The file menu's segments, by id, in row order. */
  readonly fileMenu: readonly string[];
  /** The folder menu's segments, by id, in row order. */
  readonly folderMenu: readonly string[];
}

/**
 * A host's declaration, checked whole: a host whose features read a service
 * that none of them fills does not type-check, and the error names each such
 * service under `missingServices`.
 */
export function defineHost<
  const F extends readonly Feature<any, any, any>[],
  M = MissingServices<F>,
>(
  host: HostDeclaration<F> &
    ([M] extends [never] ? unknown : { readonly missingServices: Listed<M> }),
): HostDeclaration<F> {
  return host;
}

/**
 * The settings definition of `features`: every slice they keep, in feature
 * order. A key two slices claim is a composition error.
 *
 * @throws when two slices claim one key.
 */
export function settingsDefinitionOf(
  features: readonly Feature<any, any, any>[],
): SettingsDefinition {
  const entries: Record<string, v.GenericSchema> = {};
  const defaults: Record<string, unknown> = {};
  for (const feature of features)
    for (const slice of feature.settings)
      for (const [key, schema] of Object.entries(slice.entries)) {
        if (key in entries)
          throw new Error(
            `${feature.name} claims the settings key ${key} twice`,
          );
        entries[key] = schema;
        defaults[key] = (slice.defaults as Record<string, unknown>)[key];
      }
  return {
    schema: v.object(entries) as unknown as SettingsDefinition["schema"],
    defaults: Object.freeze(defaults) as unknown as Readonly<Settings>,
  };
}

/**
 * The plugin graph over `plugin`: the shell's base, every feature's service
 * groups in build order (`buildOrder`), and above them the registrations of
 * the features in their order, with the shell's protocol handlers, setting
 * tab and view registry. A defect while a group or a registration builds
 * names it.
 */
export function pluginGraph<F extends readonly Feature<any, any, any>[]>(
  plugin: Plugin & CliHost,
  host: HostDeclaration<F>,
  options: {
    readonly languagePack: LanguagePackStartup;
    readonly built: Layer.Layer<GraphBuilt>;
  },
): Layer.Layer<ProvidesOf<F> | ShellBase | ShellProvides> {
  const groups = host.features.flatMap((feature) => feature.services);
  const order = buildOrder(groups.map(groupNode), shellBaseKeys);
  const services = stackGroups(
    layerShellBase(plugin, {
      settings: host.settings,
      languagePack: options.languagePack,
      built: options.built,
    }),
    order.map(({ group }) => group.layer.pipe(startingAs(group.name))),
  );
  const registrations = Layer.mergeAll(
    layerProtocolHandlers(
      host.features.flatMap((feature) => feature.protocol),
    ).pipe(startingAs("ProtocolHandlers")),
    ...host.features.flatMap((feature) =>
      feature.registrations.map((entry) =>
        entry.layer.pipe(startingAs(entry.name)),
      ),
    ),
    layerSettingTab(host.features, host.settingTab).pipe(
      startingAs("SettingTab"),
    ),
    layerViewRegistry.pipe(startingAs("ViewRegistry")),
  );
  return registrations.pipe(Layer.provideMerge(services)) as Layer.Layer<
    ProvidesOf<F> | ShellBase | ShellProvides
  >;
}

/** The build order of `host`'s service groups, by name, as the graph builds them. */
export function serviceOrder(
  features: readonly Feature<any, any, any>[],
): string[] {
  return buildOrder(
    features.flatMap((feature) => feature.services).map(groupNode),
    shellBaseKeys,
  ).map(({ name }) => name);
}

function groupNode(group: ServiceGroup): GroupNode & { group: ServiceGroup } {
  return {
    name: group.name,
    provides: group.provides.map((tag) => tag.key),
    requires: group.requires.map((tag) => tag.key),
    group,
  };
}
