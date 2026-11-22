import { Effect } from "effect";
import type { App } from "obsidian";

import {
  logServices,
  withLogCategory,
} from "@zotlit/plugin-kernel/effect-log.ts";

const warned = new WeakSet<App>();

function manager(app: App, members: ("getAssignedWidget" | "on" | "offref")[]) {
  const types = app.metadataTypeManager;
  const missing = types
    ? members.filter((member) => typeof types[member] !== "function")
    : ["metadataTypeManager"];
  if (missing.length === 0) return types!;
  if (!warned.has(app)) {
    warned.add(app);
    Effect.runSyncWith(logServices)(
      Effect.logWarning(
        "Obsidian's property type manager is missing; vault properties take the type of their values",
      ).pipe(
        Effect.annotateLogs({ missing }),
        withLogCategory("obsidian-private", "metadata-type-manager"),
      ),
    );
  }
  return null;
}

export function assignedWidget(app: App, name: string): string | null {
  const types = manager(app, ["getAssignedWidget"]);
  return types?.getAssignedWidget!(name) ?? null;
}

export function onTypesChanged(app: App, listener: () => void): () => void {
  const types = manager(app, ["on", "offref"]);
  if (!types) return () => {};
  const ref = types.on!("changed", () => listener());
  return () => types.offref!(ref);
}
