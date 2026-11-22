import { Effect } from "effect";
import type { App, EmbedCreator } from "obsidian";

import {
  logServices,
  withLogCategory,
} from "@zotlit/plugin-kernel/effect-log.ts";

export type { EmbedComponent, EmbedContext, EmbedCreator } from "obsidian";

export function registerEmbed(
  app: App,
  extension: string,
  creator: EmbedCreator,
): (() => void) | null {
  const registry = app.embedRegistry;
  const register = registry?.registerExtension;
  const unregister = registry?.unregisterExtension;
  const isRegistered = registry?.isExtensionRegistered;
  if (!registry || !register || !unregister || !isRegistered) {
    Effect.runSyncWith(logServices)(
      Effect.logWarning(
        "Obsidian's embed registry is missing; embeds show Obsidian's file card",
      ).pipe(
        Effect.annotateLogs({
          extension,
          missing: Object.entries({
            embedRegistry: registry,
            registerExtension: register,
            unregisterExtension: unregister,
            isExtensionRegistered: isRegistered,
          })
            .filter(([, member]) => member === undefined)
            .map(([name]) => name),
        }),
        withLogCategory("obsidian-private", "embed-registry"),
      ),
    );
    return null;
  }
  if (isRegistered.call(registry, extension))
    unregister.call(registry, extension);
  register.call(registry, extension, creator);
  return () => unregister.call(registry, extension);
}
