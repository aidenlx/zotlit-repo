import { Effect } from "effect";
import type { App } from "obsidian";

import {
  logServices,
  withLogCategory,
} from "@zotlit/plugin-kernel/effect-log.ts";

const warned = new WeakMap<App, Set<string>>();

type Member = "getFrontmatterPropertyValuesForKey" | "getTags";

function cache(app: App, member: Member) {
  const metadataCache = app.metadataCache as App["metadataCache"] | undefined;
  if (typeof metadataCache?.[member] === "function") return metadataCache;
  const members = warned.get(app) ?? new Set<string>();
  if (!members.has(member)) {
    members.add(member);
    warned.set(app, members);
    Effect.runSyncWith(logServices)(
      Effect.logWarning(
        "Obsidian's metadata cache has no read of vault values; vault properties suggest none",
      ).pipe(
        Effect.annotateLogs({ missing: member }),
        withLogCategory("obsidian-private", "property-values"),
      ),
    );
  }
  return null;
}

export function propertyValues(app: App, name: string): string[] {
  const values = cache(app, "getFrontmatterPropertyValuesForKey")
    ?.getFrontmatterPropertyValuesForKey!(name);
  return Array.isArray(values)
    ? values.filter((value): value is string => typeof value === "string")
    : [];
}

export function vaultTags(app: App): string[] {
  const tags = cache(app, "getTags")?.getTags!();
  if (tags === null || typeof tags !== "object") return [];
  return Object.keys(tags).map((tag) => tag.replace(/^#/, ""));
}
