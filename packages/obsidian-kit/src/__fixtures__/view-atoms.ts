import { Effect, FileSystem, Layer } from "effect";
import type { Context } from "effect";

import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";

import { Notifier } from "#notifier.ts";
import { ObsidianEnv } from "#obsidian-env.ts";
import { FileManager } from "#obsidian-file-manager.ts";
import { ShowInLibrary } from "#show-in-library.ts";
import { makeViewRegistry } from "#view-atoms.ts";
import type { ViewServices } from "#view-atoms.ts";

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

export const scopedViewRegistry = (context: Context.Context<ViewServices>) =>
  Effect.acquireRelease(
    Effect.sync(() => makeViewRegistry(context, { idleTTL: 0 })),
    (registry) => Effect.sync(() => registry.dispose()),
  );
