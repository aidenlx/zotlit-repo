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

export type Tag = Context.Key<any, any>;

export type IdOf<T> = T extends Context.Key<infer I, any> ? I : never;

export interface ServiceGroup<out P = unknown, out R = unknown> {
  readonly name: string;
  readonly layer: Layer.Layer<any, never, any>;
  readonly provides: readonly Tag[];
  readonly requires: readonly Tag[];
  readonly "~ports"?: () => { readonly provides: P; readonly requires: R };
}

export type Listed<T> = T extends unknown ? [T] : never;

type ListedReads<L, R> = [Exclude<ReadsOf<L>, R | ShellBase>] extends [never]
  ? unknown
  : { readonly "~unlisted": Listed<Exclude<ReadsOf<L>, R | ShellBase>> };

type ReadsOf<L> = L extends Layer.Layer<any, any, infer R> ? R : never;

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

export type ShellPluginInstance = Plugin & CliHost;

export interface FeatureContext {
  readonly plugin: ShellPluginInstance;
  readonly app: App;
  readonly manifest: PluginManifest;
  readonly stack: AsyncDisposableStack;
  readonly runtime: ManagedRuntime.ManagedRuntime<any, never>;
  readonly bridge: EffectBridge;
  readonly read: <A>(effect: Effect.Effect<A, never, any>) => A;
  readonly handlesOf: <H>(feature: Feature<any, any, H>) => H;
}

export interface ControlCodec {
  readonly claims: (key: string) => boolean;
  readonly read: (key: string) => Effect.Effect<unknown, never, SettingTabEnv>;
  readonly write: (
    key: string,
    value: unknown,
  ) => Effect.Effect<unknown, unknown, SettingTabEnv>;
}

export type SettingRows = (
  ctx: SettingTabContext,
) => SettingDefinitionItem<any>[];

export interface SettingTabContribution {
  readonly entries?: Readonly<Record<string, SettingRows>>;
  readonly slots?: Partial<
    Readonly<Record<keyof SettingTabSlots, SettingRows>>
  >;
  readonly rebuild?: readonly Effect.Effect<
    Stream.Stream<unknown>,
    never,
    any
  >[];
  readonly controls?: readonly ControlCodec[];
}

export interface FeatureMenus {
  readonly fileMenu?: Readonly<Record<string, FileMenuSegment>>;
  readonly folderMenu?: Readonly<Record<string, FolderMenuSegment>>;
}

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
  readonly handles: (ctx: FeatureContext) => H;
  readonly onload: (ctx: FeatureContext) => FeatureMenus | void;
  readonly base?: Feature<any, any, any, any>;
  readonly "~ports"?: () => { readonly provides: P; readonly requires: R };
  readonly "~settings"?: () => S;
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

export type ProvidesOf<F extends readonly Feature<any, any, any>[]> =
  FeatureProvides<F[number]>;
type FeatureProvides<T> = T extends Feature<infer P, any, any> ? P : never;

export type RequiresOf<F extends readonly Feature<any, any, any>[]> =
  FeatureRequires<F[number]>;
type FeatureRequires<T> = T extends Feature<any, infer R, any> ? R : never;

export type OpenPorts<
  F extends readonly Feature<any, any, any>[],
  Shell = never,
> = Exclude<RequiresOf<F>, ProvidesOf<F> | ShellBase | Shell>;

type UnionToIntersection<U> = (
  U extends unknown ? (value: U) => void : never
) extends (value: infer I) => void
  ? I
  : never;

export type HandlesOf<F extends readonly Feature<any, any, any>[]> =
  UnionToIntersection<FeatureHandles<F[number]>>;
type FeatureHandles<T> = T extends Feature<any, any, infer H> ? H : never;

type FeatureSettings<T> = T extends Feature<any, any, any, infer S> ? S : never;

export type LinkActionsOf<F extends readonly Feature<any, any, any>[]> =
  FeatureLinkActions<F[number]>;
type FeatureLinkActions<T> =
  T extends Feature<any, any, any, any, infer L> ? L : never;

export type ComposedSettings<F extends readonly Feature<any, any, any, any>[]> =
  UnionToIntersection<FeatureSettings<F[number]>>;
