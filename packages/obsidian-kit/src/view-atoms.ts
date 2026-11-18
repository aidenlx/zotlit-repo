import type { Notifier } from "#notifier.ts";
import type { ObsidianEnv } from "#obsidian-env.ts";
import type { FileManager } from "#obsidian-file-manager.ts";
import type { MetadataCache } from "#obsidian-metadata-cache.ts";
import type { Vault } from "#obsidian-vault.ts";
import type { Workspace } from "#obsidian-workspace.ts";
// The seam where a view reads Effect services: atoms over the plugin's
// services, held in one registry for the plugin's lifetime.
//
// What a view author uses:
//   - read a service:   useAtomValue(someServiceAtom)
//   - run a command:    useAtomSet(someCommandAtom)
//   - mount a root:     <ViewRegistryProvider registry={…}>…</ViewRegistryProvider>
// Service atoms are defined once, statically, next to the service they read
// (`services/<name>/atoms.ts`), over `viewRuntime`. Every view root shares the
// registry, so a service Stream runs once however many leaves read it, and it
// stops once no leaf reads it.
import { RegistryContext } from "@effect/atom-react";
import { Context, Effect, Layer, Option } from "effect";
import type { FileSystem, Stream } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { createElement } from "react";
import type { ReactNode } from "react";

import { scheduleBrowserTask } from "@zotlit/plugin-kernel/browser-scheduler.ts";

/**
 * The plugin's own services that a view atom may read, beside the Obsidian
 * capability tags below. The host adds an entry per service by declaration
 * merging (`declare module` on this file), keyed by the service's name; add a
 * service there when a view atom first reads it.
 */
// oxlint-disable-next-line typescript/no-empty-object-type -- the host fills it by declaration merging
export interface ViewServiceRegistry {}

/**
 * The services a view atom may read. The registry holds the plugin's whole
 * context; this union is the part view atoms are typed against.
 */
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

/**
 * The plugin's services as a Layer; each registry seeds it. Kept alive: an
 * idle node would be dropped with its seed, and the next read would fall back
 * to the failing default.
 */
const servicesLayer: Atom.Atom<Layer.Layer<ViewServices>> = Atom.keepAlive(
  Atom.make(() =>
    Layer.effectContext(
      Effect.die("view atom read on a registry without plugin services"),
    ),
  ),
);

/** Runs every view atom on the plugin's services; no second service graph. */
export const viewRuntime = Atom.runtime((get) => get(servicesLayer));

/**
 * A service's state as a plain value. State Streams (SubscriptionRef
 * `changes`) replay the current value, so `fallback` shows only until the
 * first element arrives.
 */
export function held<A>(
  stream: Stream.Stream<A, never, ViewServices>,
  fallback: A,
): Atom.Atom<A> {
  return Atom.map(viewRuntime.atom(stream), (result) =>
    Option.getOrElse(AsyncResult.value(result), () => fallback),
  );
}

/**
 * How long a node with no reader stays before its work stops. Preact runs a
 * subscription after paint, later than the registry's removal of a node read
 * during render; without this delay every mount drops and restarts the
 * node's Stream.
 */
const IDLE_TTL_MILLIS = 400;

/** A registry seeded with `context`; a test passes its own services. */
export function makeViewRegistry(
  context: Context.Context<ViewServices>,
  { idleTTL = IDLE_TTL_MILLIS }: { readonly idleTTL?: number } = {},
): AtomRegistry.AtomRegistry {
  return AtomRegistry.make({
    initialValues: [[servicesLayer, Layer.succeedContext(context)]],
    // Every atom Effect runs on this scheduler, so it takes the renderer's
    // task queue, as the plugin's runtime does.
    scheduleTask: scheduleBrowserTask,
    defaultIdleTTL: idleTTL,
    // The registry's default, half the idle delay, with a floor: a zero
    // resolution turns every node timeout into NaN.
    timeoutResolution: Math.max(1, Math.round(idleTTL / 2)),
  });
}

/** The plugin's view registry. */
export class ViewRegistry extends Context.Service<
  ViewRegistry,
  AtomRegistry.AtomRegistry
>()("zotlit/obsidian/ViewRegistry") {}

/**
 * The registry for the plugin's lifetime. Obsidian closes every view before
 * `onunload`, so no view is mounted when this layer disposes the registry;
 * it sits above the services, so it closes before the services it reads.
 */
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

/** The registry type, so an Obsidian adapter file needs no Effect import. */
export type ViewRegistryHandle = AtomRegistry.AtomRegistry;

/** Gives a React root the plugin's registry. */
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

/**
 * Calls `listener` with an atom's value and the one before it each time the
 * value changes, in the update that changed it. The node is built before the
 * subscription, so the first change after it is heard.
 *
 * @returns what stops the listening.
 */
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
