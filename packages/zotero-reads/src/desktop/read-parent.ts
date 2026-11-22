import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { ZOTERO_DB_READ_PARENT_DIRNAME } from "@zotlit/plugin-kernel/constants.ts";

export type ReadParentReason =
  | "cross-volume"
  | "same-volume"
  | "unknown-volume"
  | "network-path";

export interface ReadParentPlan {
  parents: [string, ...string[]];
  reason: ReadParentReason;
}

export interface ReadParentInputs {
  databasePath: string;
  tempDevice: bigint;
  databaseDevice: bigint;
}

export function planReadParents({
  databasePath,
  tempDevice,
  databaseDevice,
}: ReadParentInputs): ReadParentPlan {
  const temp = tmpdir();
  if (isUncPath(databasePath))
    return { parents: [temp], reason: "network-path" };
  if (tempDevice === 0n || databaseDevice === 0n)
    return { parents: [temp], reason: "unknown-volume" };
  if (tempDevice === databaseDevice)
    return { parents: [temp], reason: "same-volume" };
  return {
    parents: [readParentBeside(databasePath), temp],
    reason: "cross-volume",
  };
}

export function readParentBeside(databasePath: string): string {
  return join(dirname(databasePath), ZOTERO_DB_READ_PARENT_DIRNAME);
}

const UNC_PREFIX = "\\\\";
const LONG_PATH_PREFIX = "\\\\?\\";
const LONG_UNC_PREFIX = "\\\\?\\UNC\\";

function isUncPath(path: string): boolean {
  if (!path.startsWith(UNC_PREFIX)) return false;
  if (!path.startsWith(LONG_PATH_PREFIX)) return true;
  return path.toUpperCase().startsWith(LONG_UNC_PREFIX);
}
