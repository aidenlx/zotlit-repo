// A view registry for tests, and the kit's view services a test host leaves
// unread, so its registry context is whole. Each member dies when called.
import { Effect, FileSystem, Layer } from "effect";
import type { Context } from "effect";

import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";

import { Notifier } from "#notifier.ts";
import { ObsidianEnv } from "#obsidian-env.ts";
import { FileManager } from "#obsidian-file-manager.ts";
import { ShowInLibrary } from "#show-in-library.ts";
import { makeViewRegistry } from "#view-atoms.ts";
import type { ViewServices } from "#view-atoms.ts";

/**
 * The kit's view services outside the Obsidian host tags, as empty mocks.
 * Merge it first: a service the test reads, merged after it, takes its place.
 */
export const layerUnreadKitViewServices = Layer.mergeAll(
  Layer.mock(FileManager, {}),
  Layer.succeed(
    FileSystem.FileSystem,
    stubService<FileSystem.FileSystem>("FileSystem", {}),
  ),
  Layer.mock(
    ObsidianEnv,
    stubService<ObsidianEnv["Service"]>("ObsidianEnv", {}),
  ),
  Layer.mock(Notifier, {}),
  Layer.mock(ShowInLibrary, {}),
);

/**
 * A view registry over `context`, with no idle delay, disposed when the
 * current scope closes, a failed assertion included.
 */
export const scopedViewRegistry = (context: Context.Context<ViewServices>) =>
  Effect.acquireRelease(
    Effect.sync(() => makeViewRegistry(context, { idleTTL: 0 })),
    (registry) => Effect.sync(() => registry.dispose()),
  );
