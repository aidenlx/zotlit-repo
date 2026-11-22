import { sourceIdFromUris } from "@zotlit/protocol";

import { logger } from "@/lib/logger.ts";

export interface DebugDirs {
  profilePath?: string;
  dataPath?: string;
}

interface Cached {
  profileDir: string;
  dataDir: string;
  sourceId: string;
}

let cached: Cached | undefined;

function resolve(): Cached {
  if (!cached) {
    const profileDir = Zotero.Profile.dir;
    const dataDir = Zotero.DataDirectory.dir;
    cached = {
      profileDir,
      dataDir,
      sourceId: sourceIdFromUris(
        Zotero.File.pathToFileURI(profileDir),
        Zotero.File.pathToFileURI(dataDir),
      ),
    };
  }
  return cached;
}

export function sourceId(): string {
  return resolve().sourceId;
}

export function sourceDebugDirs(): DebugDirs {
  if (!logger.isEnabledFor("debug")) return {};
  const { profileDir, dataDir } = resolve();
  return { profilePath: profileDir, dataPath: dataDir };
}
