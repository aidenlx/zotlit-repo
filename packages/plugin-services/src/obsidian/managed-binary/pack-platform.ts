// The platform boundary of a Managed Binary that ships in the Resource Pack:
// where the installed pack is, and the read of one Pack Entry from it.
import { Context, Effect, Layer } from "effect";

import { ObsidianApp } from "@zotlit/obsidian-kit/obsidian-app.ts";
import { fetchRange } from "@zotlit/resource-pack/fetch-range.ts";
import { readPackEntry } from "@zotlit/resource-pack/reader.ts";
import type { PackRead, ReadRange } from "@zotlit/resource-pack/reader.ts";

/** The plugin id of the Resource Pack. */
export const RESOURCE_PACK_ID = "zotlit-resources";

/** The page of the Resource Pack in Obsidian's community plugin browser. */
export const RESOURCE_PACK_PAGE = `obsidian://show-plugin?id=${RESOURCE_PACK_ID}`;

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
}

export interface ResourcePackPorts {
  readonly locate: Effect.Effect<PackLocation | null>;
  /** One read of the Pack Entry `name`: its verified bytes, or why the pack gave none. */
  readEntry(location: PackLocation, name: string): Effect.Effect<PackRead>;
}

export class ResourcePackPlatform extends Context.Service<
  ResourcePackPlatform,
  ResourcePackPorts
>()("zotlit/managed-binary/ResourcePackPlatform") {}

/** Wrap the host APIs once, at their boundary. */
export function resourcePackPorts(
  host: ResourcePackHostPorts,
): ResourcePackPorts {
  return {
    locate: Effect.sync(() => host.locate()),
    readEntry: Effect.fn("ResourcePackPlatform.readEntry")(
      (location: PackLocation, name: string) =>
        // boundary: the pack reader answers each failure as a value.
        Effect.promise(() => readPackEntry(host.open(location.url), name)),
    ),
  };
}

/**
 * The platform over Obsidian's installed plugins and `fetch`. Obsidian adds
 * the time of the call to the resource URL of a file outside the vault's
 * index, so the location drops that part and stays equal between calls.
 */
export const layerResourcePackPlatform = Layer.effect(
  ResourcePackPlatform,
  Effect.gen(function* () {
    const app = yield* ObsidianApp;
    return resourcePackPorts({
      locate: () => {
        const manifest = app.plugins.manifests[RESOURCE_PACK_ID];
        if (!manifest?.dir) return null;
        const url = app.vault.adapter.getResourcePath(
          `${manifest.dir}/main.js`,
        );
        const query = url.lastIndexOf("?");
        return {
          version: manifest.version,
          url: query < 0 ? url : url.slice(0, query),
        };
      },
      open: (url) => fetchRange(url),
    });
  }),
);
