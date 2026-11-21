// The platform boundary of a Managed Binary that ships in the Resource Pack:
// where the installed pack is, and the read of one Pack Entry from it.
import { Context, Effect, Layer, PubSub, Stream } from "effect";
import type { Scope } from "effect";

import { ObsidianApp } from "@zotlit/obsidian-kit/obsidian-app.ts";
import { fetchRange } from "@zotlit/resource-pack/fetch-range.ts";
import { readPackEntry } from "@zotlit/resource-pack/reader.ts";
import type { PackRead, ReadRange } from "@zotlit/resource-pack/reader.ts";

/** The plugin id of the Resource Pack. */
export const RESOURCE_PACK_ID = "zotlit-resources";

/** The page of the Resource Pack in Obsidian's community plugin browser. */
const RESOURCE_PACK_PAGE = `obsidian://show-plugin?id=${RESOURCE_PACK_ID}`;

/** Opens the Resource Pack's page in Obsidian's community plugin browser. */
export function openResourcePackPage(): void {
  window.open(RESOURCE_PACK_PAGE);
}

/** The installed Resource Pack. */
export interface PackLocation {
  /** The version its manifest states. */
  readonly version: string;
  /** The resource URL of its `main.js`, the same on every call. */
  readonly url: string;
}

/** Host APIs adapted at the platform boundary. */
export interface ResourcePackHostPorts {
  /** The pack Obsidian lists as installed, enabled or not; `null` for none. */
  locate(): PackLocation | null;
  /** The read capability over the pack file at `url`. */
  open(url: string): ReadRange;
  /**
   * Calls `listener` each time Obsidian installs, updates or removes the
   * pack, until the function it answers is called.
   */
  watch(listener: () => void): () => void;
}

export interface ResourcePackPorts {
  readonly locate: Effect.Effect<PackLocation | null>;
  /** One read of the Pack Entry `name`: its verified bytes, or why the pack gave none. */
  readEntry(location: PackLocation, name: string): Effect.Effect<PackRead>;
  /** One element each time Obsidian installs, updates or removes the pack. */
  readonly changes: Stream.Stream<void>;
}

export class ResourcePackPlatform extends Context.Service<
  ResourcePackPlatform,
  ResourcePackPorts
>()("zotlit/managed-binary/ResourcePackPlatform") {}

/** Wrap the host APIs once, at their boundary; the watch lives on the Scope. */
export const resourcePackPorts = Effect.fnUntraced(function* (
  host: ResourcePackHostPorts,
): Effect.fn.Return<ResourcePackPorts, never, Scope.Scope> {
  const changed = yield* Effect.acquireRelease(
    PubSub.unbounded<void>(),
    (bus) => PubSub.shutdown(bus),
  );
  yield* Effect.acquireRelease(
    Effect.sync(() =>
      host.watch(() => {
        PubSub.publishUnsafe(changed, undefined);
      }),
    ),
    (stop) => Effect.sync(stop),
  );
  return {
    locate: Effect.sync(() => host.locate()),
    readEntry: Effect.fn("ResourcePackPlatform.readEntry")(
      (location: PackLocation, name: string) =>
        // boundary: the pack reader answers each failure as a value.
        Effect.promise(() => readPackEntry(host.open(location.url), name)),
    ),
    changes: Stream.fromPubSub(changed),
  };
});

/**
 * The platform over Obsidian's installed plugins and `fetch`. Obsidian adds
 * the time of the call to the resource URL of a file outside the vault's
 * index, so the location drops that part and stays equal between calls.
 *
 * Obsidian reads the manifest of a plugin again when it installs or updates
 * it, and drops the manifest when it uninstalls it, then reports a change of
 * its plugins. The same report follows each plugin turned on or off, so the
 * watch passes on only a report that finds another manifest of the pack.
 */
export const layerResourcePackPlatform = Layer.effect(
  ResourcePackPlatform,
  Effect.gen(function* () {
    const app = yield* ObsidianApp;
    const manifest = () => app.plugins.manifests[RESOURCE_PACK_ID];
    return yield* resourcePackPorts({
      watch: (listener) => {
        let seen = manifest();
        const ref = app.plugins.on("changed", () => {
          const next = manifest();
          if (next === seen) return;
          seen = next;
          listener();
        });
        return () => {
          app.plugins.offref(ref);
        };
      },
      locate: () => {
        const installed = manifest();
        if (!installed?.dir) return null;
        const url = app.vault.adapter.getResourcePath(
          `${installed.dir}/main.js`,
        );
        const query = url.lastIndexOf("?");
        return {
          version: installed.version,
          url: query < 0 ? url : url.slice(0, query),
        };
      },
      open: (url) => fetchRange(url),
    });
  }),
);
