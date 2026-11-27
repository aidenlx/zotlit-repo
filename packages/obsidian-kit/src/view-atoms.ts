import type { Notifier } from "#notifier.ts";
import type { ObsidianEnv } from "#obsidian-env.ts";
import type { FileManager } from "#obsidian-file-manager.ts";
import type { MetadataCache } from "#obsidian-metadata-cache.ts";
import type { Vault } from "#obsidian-vault.ts";
import type { Workspace } from "#obsidian-workspace.ts";
import { RegistryContext } from "@effect/atom-react";
import type { FileSystem, Stream } from "effect";
import { Context, Effect, Layer, Option } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import type { ReactNode } from "react";
import { createElement } from "react";

import { scheduleBrowserTask } from "@zotlit/plugin-kernel/browser-scheduler.ts";

// oxlint-disable-next-line typescript/no-empty-object-type -- the host fills it by declaration merging
export interface ViewServiceRegistry {}

export type ViewServices =
  | FileManager
  | FileSystem.FileSystem
  | ObsidianEnv
  | MetadataCache
  | Notifier
  | Vault
  | Workspace
  // oxlint-disable-next-line typescript/no-redundant-type-constituents -- empty until the host merges its services in
  | ViewServiceRegistry[keyof ViewServiceRegistry];

const servicesLayer: Atom.Atom<Layer.Layer<ViewServices>> = Atom.keepAlive(
  Atom.make(() =>
    Layer.effectContext(
      Effect.die("view atom read on a registry without plugin services"),
    ),
  ),
);

export const viewRuntime = Atom.runtime((get) => get(servicesLayer));

export function held<A>(
  stream: Stream.Stream<A, never, ViewServices>,
  fallback: A,
): Atom.Atom<A> {
  return Atom.map(viewRuntime.atom(stream), (result) =>
    Option.getOrElse(AsyncResult.value(result), () => fallback),
  );
}

const IDLE_TTL_MILLIS = 400;

export function makeViewRegistry(
  context: Context.Context<ViewServices>,
  { idleTTL = IDLE_TTL_MILLIS }: { readonly idleTTL?: number } = {},
): AtomRegistry.AtomRegistry {
  return AtomRegistry.make({
    initialValues: [[servicesLayer, Layer.succeedContext(context)]],
    scheduleTask: scheduleBrowserTask,
    defaultIdleTTL: idleTTL,
    timeoutResolution: Math.max(1, Math.round(idleTTL / 2)),
  });
}

export class ViewRegistry extends Context.Service<
  ViewRegistry,
  AtomRegistry.AtomRegistry
>()("zotlit/obsidian/ViewRegistry") {}

export const layerViewRegistry: Layer.Layer<ViewRegistry, never, ViewServices> =
  Layer.effect(
    ViewRegistry,
    Effect.acquireRelease(
      Effect.map(Effect.context<ViewServices>(), (context) =>
        makeViewRegistry(context),
      ),
      (registry) => Effect.sync(() => registry.dispose()),
    ),
  );

export type ViewRegistryHandle = AtomRegistry.AtomRegistry;

export function ViewRegistryProvider(props: {
  readonly registry: AtomRegistry.AtomRegistry;
  readonly children?: ReactNode;
}) {
  return createElement(
    RegistryContext.Provider,
    { value: props.registry },
    props.children,
  );
}

export function watch<A>(
  registry: AtomRegistry.AtomRegistry,
  atom: Atom.Atom<A>,
  listener: (value: A, previous: A) => void,
): () => void {
  let previous = registry.get(atom);
  return registry.subscribe(atom, (value) => {
    const before = previous;
    previous = value;
    listener(value, before);
  });
}
