import { Effect, FileSystem } from "effect";
import { homedir } from "node:os";
import { join } from "node:path";

import { requireElectronRemote } from "@zotlit/obsidian-desktop/require.ts";

function profilePaths(): { root: string; legacyRoot?: string } {
  switch (process.platform) {
    case "win32":
      return {
        root: join(
          requireElectronRemote().app.getPath("appData"),
          "Zotero",
          "Zotero",
        ),
      };
    case "darwin":
      return {
        root: join(requireElectronRemote().app.getPath("appData"), "Zotero"),
      };
    default: {
      const legacyRoot = join(homedir(), ".zotero", "zotero");
      if (process.env.MOZ_LEGACY_HOME?.startsWith("1"))
        return { root: legacyRoot };
      return {
        root: join(
          requireElectronRemote().app.getPath("appData"),
          "zotero",
          "zotero",
        ),
        legacyRoot,
      };
    }
  }
}

export const zoteroProfilesRoot = Effect.gen(function* () {
  const { root, legacyRoot } = yield* Effect.sync(profilePaths);
  if (legacyRoot) {
    const fs = yield* FileSystem.FileSystem;
    if (yield* fs.exists(legacyRoot)) return legacyRoot;
  }
  return root;
}).pipe(Effect.withSpan("ZoteroPref.profilesRoot"));
