import { Context, Effect, Layer, PubSub, Stream } from "effect";

import { obsidianEvents } from "@zotlit/obsidian-kit/effect-obsidian-events.ts";
import { ObsidianApp } from "@zotlit/obsidian-kit/obsidian-app.ts";
import { showPluginPage } from "@zotlit/obsidian-kit/plugin-page.ts";
import { fetchRange } from "@zotlit/resource-pack/fetch-range.ts";
import { readPackEntry } from "@zotlit/resource-pack/reader.ts";
import type { PackRead, ReadRange } from "@zotlit/resource-pack/reader.ts";

import { RESOURCE_PACK_ID } from "#core/managed-binary/resource-pack.ts";

export function openResourcePackPage(): void {
  window.open(showPluginPage(RESOURCE_PACK_ID));
}

export interface PackLocation {
  readonly version: string;
  readonly url: string;
}

export interface ResourcePackHostPorts {
  locate(): PackLocation | null;
  open(url: string): ReadRange;
  readonly changes: Stream.Stream<void>;
}

export interface ResourcePackPorts {
  readonly locate: Effect.Effect<PackLocation | null>;
  readEntry(location: PackLocation, name: string): Effect.Effect<PackRead>;
  readonly changes: Stream.Stream<void>;
}

export class ResourcePackPlatform extends Context.Service<
  ResourcePackPlatform,
  ResourcePackPorts
>()("zotlit/managed-binary/ResourcePackPlatform") {}

export function resourcePackPorts(
  host: ResourcePackHostPorts,
): ResourcePackPorts {
  return {
    locate: Effect.sync(() => host.locate()),
    readEntry: Effect.fn("ResourcePackPlatform.readEntry")(
      (location: PackLocation, name: string) =>
        Effect.promise(() => readPackEntry(host.open(location.url), name)),
    ),
    changes: host.changes,
  };
}

export const layerResourcePackPlatform = Layer.effect(
  ResourcePackPlatform,
  Effect.gen(function* () {
    const app = yield* ObsidianApp;
    const manifest = () => app.plugins.manifests[RESOURCE_PACK_ID];
    const events = yield* obsidianEvents<{ changed: [] }>();
    const changed = yield* Effect.acquireRelease(
      PubSub.unbounded<void>(),
      (bus) => PubSub.shutdown(bus),
    );
    let seen = manifest();
    yield* events.on("changed", app.plugins, "changed");
    yield* events
      .consume(() =>
        Effect.suspend(() => {
          const next = manifest();
          if (next === seen) return Effect.void;
          seen = next;
          return PubSub.publish(changed, undefined);
        }),
      )
      .pipe(Effect.forkScoped({ startImmediately: true }));
    return resourcePackPorts({
      changes: Stream.fromPubSub(changed),
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
