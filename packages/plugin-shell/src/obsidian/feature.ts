// What a feature package hands a host: one value that names its service
// groups with the tags they fill and read, its registrations, its settings
// slices, its setting rows, its `obsidian://` actions, its menu entries and
// its start-up hook. The shell derives the plugin graph, the settings
// definition, the setting tab and the registrations from a list of them.
import type {
  Context,
  Effect,
  Layer,
  ManagedRuntime,
  Scope,
  Stream,
} from "effect";
import type {
  App,
  ObsidianProtocolData,
  Plugin,
  PluginManifest,
  SettingDefinitionItem,
} from "obsidian";

import type { CliHost } from "@zotlit/obsidian-kit/cli-command.ts";
import type { EffectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import type {
  SettingsEntries,
  SettingsSlice,
  SliceSettings,
} from "@zotlit/plugin-services/core/settings/slice.ts";
import type {
  FileMenuSegment,
  FolderMenuSegment,
} from "@zotlit/plugin-services/obsidian/file-menu.ts";
import type {
  SettingTabContext,
  SettingTabSlots,
} from "@zotlit/plugin-services/obsidian/setting-tab/context.ts";
import type { SettingTabEnv } from "@zotlit/plugin-services/obsidian/setting-tab/effect-tab.ts";

import type { ShellBase } from "./base.ts";

/** A tag a service group fills or reads. */
export type Tag = Context.Key<any, any>;

/** The service a tag stands for, as a Layer's type names it. */
export type IdOf<T> = T extends Context.Key<infer I, any> ? I : never;

/**
 * Services that build together, with the tags they fill and the tags of
 * other groups they read. `layer`'s type holds the group to its lists: it
 * provides every tag of `provides` and reads nothing outside `requires` and
 * the shell's base.
 */
export interface ServiceGroup<out P = unknown, out R = unknown> {
  readonly name: string;
  readonly layer: Layer.Layer<any, never, any>;
  readonly provides: readonly Tag[];
  readonly requires: readonly Tag[];
  /** Type-level only: the services the group fills and reads. */
  readonly "~ports"?: () => { readonly provides: P; readonly requires: R };
}

/** One tuple per service, so a type error names each service apart. */
export type Listed<T> = T extends unknown ? [T] : never;

/**
 * What `layer` reads that the group's `requires` and the shell's base leave
 * out: nothing, or a type error that names each of them under `~unlisted`.
 */
type ListedReads<L, R> = [Exclude<ReadsOf<L>, R | ShellBase>] extends [never]
  ? unknown
  : { readonly "~unlisted": Listed<Exclude<ReadsOf<L>, R | ShellBase>> };

/** The services a layer reads. */
type ReadsOf<L> = L extends Layer.Layer<any, any, infer R> ? R : never;

/**
 * A service group. A defect while `layer` builds names `name`, unless an
 * inner layer already named itself (`startingAs`).
 */
export function serviceGroup<
  const P extends readonly [Tag, ...Tag[]],
  L extends Layer.Layer<IdOf<P[number]>, never, any>,
  const R extends readonly Tag[] = readonly [],
>(
  name: string,
  ports: { readonly provides: P; readonly requires?: R },
  layer: L & ListedReads<L, IdOf<R[number]>>,
): ServiceGroup<IdOf<P[number]>, IdOf<R[number]>> {
  return {
    name,
    layer,
    provides: ports.provides,
    requires: ports.requires ?? [],
  };
}

/**
 * A layer that registers on the plugin (commands, notices, editor
 * extensions) and holds no service of its own. Registrations build above
 * every service group and may read any service.
 */
export interface Registration<out R = unknown> {
  readonly name: string;
  readonly layer: Layer.Layer<never, never, any>;
  readonly "~requires"?: () => R;
}

export function registration<R>(
  name: string,
  layer: Layer.Layer<never, never, R>,
): Registration<Exclude<R, ShellBase>> {
  return { name, layer };
}

/**
 * An `obsidian://zotlit/<action>` handler: the shell registers it and runs it
 * on the plugin's Scope. A handler may read that Scope (`Scope.Scope`) to run
 * work that outlives its own run, such as a modal's callbacks; unload closes
 * it.
 */
export interface ProtocolHandler<
  out R = unknown,
  out A extends string = string,
> {
  readonly action: A;
  readonly handle: (
    data: ObsidianProtocolData,
  ) => Effect.Effect<unknown, unknown, any>;
  readonly "~requires"?: () => R;
}

export function protocolHandler<R, const A extends string>(
  action: A,
  handle: (data: ObsidianProtocolData) => Effect.Effect<unknown, unknown, R>,
): ProtocolHandler<Exclude<R, ShellBase | Scope.Scope>, A> {
  return { action, handle };
}

/** The plugin a feature's start-up hook registers on. */
export type ShellPluginInstance = Plugin & CliHost;

/** What a feature's handles and start-up hook read, once the graph has built. */
export interface FeatureContext {
  readonly plugin: ShellPluginInstance;
  readonly app: App;
  readonly manifest: PluginManifest;
  /** The start-up stack: what goes on it releases at unload, before the graph closes. */
  readonly stack: AsyncDisposableStack;
  readonly runtime: ManagedRuntime.ManagedRuntime<any, never>;
  readonly bridge: EffectBridge;
  /**
   * Run a synchronous Effect on the built graph: the service of a tag, or a
   * context of several (`Effect.context<…>()`), read once.
   */
  readonly read: <A>(effect: Effect.Effect<A, never, any>) => A;
  /**
   * The handles another composed feature gave the debug surface.
   *
   * @throws when the host did not compose `feature`.
   */
  readonly handlesOf: <H>(feature: Feature<any, any, H>) => H;
}

/** A declarative `control` key this feature stores itself, away from a plain settings key. */
export interface ControlCodec {
  readonly claims: (key: string) => boolean;
  readonly read: (key: string) => Effect.Effect<unknown, never, SettingTabEnv>;
  readonly write: (
    key: string,
    value: unknown,
  ) => Effect.Effect<unknown, unknown, SettingTabEnv>;
}

/** Rows a feature builds for the setting tab. */
export type SettingRows = (
  ctx: SettingTabContext,
) => SettingDefinitionItem<any>[];

/** What a feature adds to the setting tab. */
export interface SettingTabContribution {
  /** Top-level items and pages by id; the host's tab order places them. */
  readonly entries?: Readonly<Record<string, SettingRows>>;
  /** Rows for a slot another feature's page holds (`ctx.slot`). */
  readonly slots?: Partial<
    Readonly<Record<keyof SettingTabSlots, SettingRows>>
  >;
  /**
   * Streams whose elements move rows that are included or left out: each
   * element rebuilds the tab. A stream that replays its current value drops
   * it itself.
   */
  readonly rebuild?: readonly Effect.Effect<
    Stream.Stream<unknown>,
    never,
    any
  >[];
  readonly controls?: readonly ControlCodec[];
}

/** The menu entries a start-up hook made, by id; the host's menu order places them. */
export interface FeatureMenus {
  readonly fileMenu?: Readonly<Record<string, FileMenuSegment>>;
  readonly folderMenu?: Readonly<Record<string, FolderMenuSegment>>;
}

/**
 * One feature, as a host composes it. `P` and `R` are the services its
 * groups fill and the services its groups, registrations and handlers read;
 * `H` is what it adds to the debug surface; `L` is the `obsidian://` actions
 * its handlers register.
 */
export interface Feature<
  out P = unknown,
  out R = unknown,
  out H = unknown,
  out S = unknown,
  out L = unknown,
> {
  readonly name: string;
  readonly services: readonly ServiceGroup[];
  readonly registrations: readonly Registration[];
  readonly settings: readonly SettingsSlice<SettingsEntries>[];
  readonly settingTab: SettingTabContribution;
  readonly protocol: readonly ProtocolHandler[];
  /** The values the debug surface and the End-to-end Run read. */
  readonly handles: (ctx: FeatureContext) => H;
  /**
   * Register what is not an Effect layer yet: views, editor suggests,
   * ribbon icons. Hooks run in the host's feature order, after the graph
   * built and every feature's handles were made.
   */
  readonly onload: (ctx: FeatureContext) => FeatureMenus | void;
  /**
   * The feature this one extends (`extendFeature`). Another feature that
   * reads `handlesOf(base)` gets this feature's handles.
   */
  readonly base?: Feature<any, any, any, any>;
  readonly "~ports"?: () => { readonly provides: P; readonly requires: R };
  /** Type-level only: the settings each slice keeps, one union member per slice. */
  readonly "~settings"?: () => S;
  /** Type-level only: the actions its handlers register, one union member per action. */
  readonly "~linkActions"?: () => L;
}

type SlicesSettings<T> =
  T extends SettingsSlice<SettingsEntries> ? SliceSettings<T> : never;

type GroupProvides<G> = G extends ServiceGroup<infer P, any> ? P : never;
type GroupRequires<G> =
  G extends ServiceGroup<any, infer R>
    ? R
    : G extends Registration<infer R>
      ? R
      : G extends ProtocolHandler<infer R>
        ? R
        : never;

type HandlerActions<T> = T extends ProtocolHandler<any, infer A> ? A : never;

/** The parts of a feature, as a feature package writes them. */
export interface FeatureParts<
  S extends readonly ServiceGroup<any, any>[],
  G extends readonly Registration<any>[],
  A extends readonly ProtocolHandler<any>[],
  H,
  K extends readonly SettingsSlice<any>[],
> {
  readonly name: string;
  readonly services?: S;
  readonly registrations?: G;
  readonly settings?: K;
  readonly settingTab?: SettingTabContribution;
  readonly protocol?: A;
  readonly handles?: (ctx: FeatureContext) => H;
  readonly onload?: (ctx: FeatureContext) => FeatureMenus | void;
}

/** A feature from its parts: the services it fills and reads come from their types. */
export function defineFeature<
  const S extends readonly ServiceGroup<any, any>[] = readonly [],
  const G extends readonly Registration<any>[] = readonly [],
  const A extends readonly ProtocolHandler<any>[] = readonly [],
  H = Record<never, never>,
  const K extends readonly SettingsSlice<any>[] = readonly [],
>(
  parts: FeatureParts<S, G, A, H, K>,
): Feature<
  GroupProvides<S[number]>,
  GroupRequires<S[number] | G[number] | A[number]>,
  H,
  SlicesSettings<K[number]>,
  HandlerActions<A[number]>
> {
  return {
    name: parts.name,
    services: parts.services ?? [],
    registrations: parts.registrations ?? [],
    settings: parts.settings ?? [],
    settingTab: parts.settingTab ?? {},
    protocol: parts.protocol ?? [],
    handles: parts.handles ?? (() => ({}) as H),
    onload: parts.onload ?? (() => undefined),
  };
}

/**
 * `base` with the parts only one kind of host composes, such as the desktop
 * groups that read Node: one feature, so a host lists it once and its
 * services, registrations, handlers and hooks run in one place of the host's
 * order. The base's parts come first: its groups, registrations, slices,
 * handlers, rebuild streams and codecs, then the extension's. A slot both
 * fill takes the base's rows, then the extension's. The handles merge, and
 * `handlesOf(base)` reads them. The menus of both hooks merge.
 *
 * @throws when the extension gives a setting entry the base gives.
 */
export function extendFeature<
  B extends Feature<any, any, any, any>,
  const S extends readonly ServiceGroup<any, any>[] = readonly [],
  const G extends readonly Registration<any>[] = readonly [],
  const A extends readonly ProtocolHandler<any>[] = readonly [],
  H = Record<never, never>,
  const K extends readonly SettingsSlice<any>[] = readonly [],
>(
  base: B,
  parts: Omit<FeatureParts<S, G, A, H, K>, "name">,
): Feature<
  FeatureProvides<B> | GroupProvides<S[number]>,
  FeatureRequires<B> | GroupRequires<S[number] | G[number] | A[number]>,
  FeatureHandles<B> & H,
  FeatureSettings<B> | SlicesSettings<K[number]>,
  FeatureLinkActions<B> | HandlerActions<A[number]>
> {
  const extension = defineFeature({ name: base.name, ...parts });
  return {
    name: base.name,
    base,
    services: [...base.services, ...extension.services],
    registrations: [...base.registrations, ...extension.registrations],
    settings: [...base.settings, ...extension.settings],
    settingTab: mergeSettingTab(base, extension.settingTab),
    protocol: [...base.protocol, ...extension.protocol],
    handles: (ctx) => ({ ...base.handles(ctx), ...extension.handles(ctx) }),
    onload: (ctx) => {
      const before = base.onload(ctx) ?? {};
      const after = extension.onload(ctx) ?? {};
      return {
        fileMenu: { ...before.fileMenu, ...after.fileMenu },
        folderMenu: { ...before.folderMenu, ...after.folderMenu },
      };
    },
  };
}

/** The setting tab parts of `base`, then of `extension`. */
function mergeSettingTab(
  base: Feature<any, any, any, any>,
  extension: SettingTabContribution,
): SettingTabContribution {
  const entries = { ...base.settingTab.entries };
  for (const [id, rows] of Object.entries(extension.entries ?? {})) {
    if (id in entries)
      throw new Error(`${base.name} gives the setting entry ${id} twice`);
    entries[id] = rows;
  }
  const slots: Partial<Record<string, SettingRows>> = {
    ...base.settingTab.slots,
  };
  const added: Partial<Record<string, SettingRows>> = extension.slots ?? {};
  for (const [id, rows] of Object.entries(added)) {
    const before = slots[id];
    if (!rows) continue;
    slots[id] = before ? (ctx) => [...before(ctx), ...rows(ctx)] : rows;
  }
  return {
    entries,
    slots,
    rebuild: [...(base.settingTab.rebuild ?? []), ...(extension.rebuild ?? [])],
    controls: [
      ...(base.settingTab.controls ?? []),
      ...(extension.controls ?? []),
    ],
  };
}

/** The services the features of `F` fill. */
export type ProvidesOf<F extends readonly Feature<any, any, any>[]> =
  FeatureProvides<F[number]>;
type FeatureProvides<T> = T extends Feature<infer P, any, any> ? P : never;

/** The services the features of `F` read. */
export type RequiresOf<F extends readonly Feature<any, any, any>[]> =
  FeatureRequires<F[number]>;
type FeatureRequires<T> = T extends Feature<any, infer R, any> ? R : never;

/**
 * The services a feature of `F` reads that neither another feature of `F`
 * nor the shell fills: the ports a host leaves open.
 */
export type OpenPorts<
  F extends readonly Feature<any, any, any>[],
  Shell = never,
> = Exclude<RequiresOf<F>, ProvidesOf<F> | ShellBase | Shell>;

type UnionToIntersection<U> = (
  U extends unknown ? (value: U) => void : never
) extends (value: infer I) => void
  ? I
  : never;

/** The debug surface the features of `F` give together. */
export type HandlesOf<F extends readonly Feature<any, any, any>[]> =
  UnionToIntersection<FeatureHandles<F[number]>>;
type FeatureHandles<T> = T extends Feature<any, any, infer H> ? H : never;

type FeatureSettings<T> = T extends Feature<any, any, any, infer S> ? S : never;

/** The `obsidian://` actions the handlers of the features of `F` register. */
export type LinkActionsOf<F extends readonly Feature<any, any, any>[]> =
  FeatureLinkActions<F[number]>;
type FeatureLinkActions<T> =
  T extends Feature<any, any, any, any, infer L> ? L : never;

/**
 * The settings the slices of `F` keep, as one map. A host holds it equal to
 * the registered `Settings`, so every key a slice registers has a feature
 * that keeps it.
 */
export type ComposedSettings<F extends readonly Feature<any, any, any, any>[]> =
  UnionToIntersection<FeatureSettings<F[number]>>;
