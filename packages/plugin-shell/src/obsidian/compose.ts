import type { GroupNode } from "#core/graph.ts";
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
import type {
  LanguagePackIdentity,
  LanguagePackStartup,
} from "@zotlit/plugin-services/obsidian/language-pack/service.ts";
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

export type ShellProvides = ViewRegistry;

type ShellReads = ViewServices | Exclude<SettingTabEnv, SettingTab>;

export type MissingServices<F extends readonly Feature<any, any, any>[]> =
  | OpenPorts<F, ShellProvides>
  | Exclude<ShellReads, ProvidesOf<F> | ShellBase | ShellProvides>;

export type LinkActionsCheck<Registered, Given> = ([
  Exclude<Registered, Given>,
] extends [never]
  ? unknown
  : {
      readonly missingLinkActions: Listed<Exclude<Registered, Given>>;
    }) &
  ([Exclude<Given, Registered>] extends [never]
    ? unknown
    : {
        readonly unregisteredLinkActions: Listed<Exclude<Given, Registered>>;
      });

export interface HostDeclaration<F extends readonly Feature<any, any, any>[]> {
  readonly features: F;
  readonly settings: PluginSettingsOptions;
  readonly languagePack: LanguagePackIdentity;
  readonly settingTab: SettingTabOrder;
  readonly fileMenu: readonly string[];
  readonly folderMenu: readonly string[];
}

export function defineHost<
  const F extends readonly Feature<any, any, any>[],
  M = MissingServices<F>,
>(
  host: HostDeclaration<F> &
    ([M] extends [never] ? unknown : { readonly missingServices: Listed<M> }),
): HostDeclaration<F> {
  return host;
}

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

export function pluginGraph<F extends readonly Feature<any, any, any>[]>(
  plugin: Plugin & CliHost,
  host: HostDeclaration<F>,
  options: {
    readonly languagePack: LanguagePackStartup;
    readonly built: Layer.Layer<GraphBuilt>;
  },
): Layer.Layer<ProvidesOf<F> | ShellBase | ShellProvides> {
  const services = featureServices(
    host.features,
    layerShellBase(plugin, {
      settings: host.settings,
      languagePack: options.languagePack,
      built: options.built,
    }),
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
  ).pipe(
    Layer.provideMerge(layerViewRegistry.pipe(startingAs("ViewRegistry"))),
  );
  return stackGroups(services, [registrations]) as Layer.Layer<
    ProvidesOf<F> | ShellBase | ShellProvides
  >;
}

export function featureServices<F extends readonly Feature<any, any, any>[]>(
  features: F,
  base: Layer.Layer<ShellBase>,
): Layer.Layer<ProvidesOf<F> | ShellBase> {
  const groups = features.flatMap((feature) => feature.services);
  const order = buildOrder(groups.map(groupNode), shellBaseKeys);
  return stackGroups(
    base,
    order.map(({ group }) => group.layer.pipe(startingAs(group.name))),
  ) as Layer.Layer<ProvidesOf<F> | ShellBase>;
}

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
