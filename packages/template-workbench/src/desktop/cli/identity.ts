import { Effect } from "effect";

import { ObsidianEnv } from "@zotlit/obsidian-kit/obsidian-env.ts";
import { VaultDisk } from "@zotlit/obsidian-kit/obsidian-vault-disk.ts";
import { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";

import type { WorkbenchIdentity } from "./envelope.ts";

export const readWorkbenchIdentity: Effect.Effect<
  WorkbenchIdentity,
  never,
  ObsidianEnv | VaultDisk | ZoteroPref
> = Effect.gen(function* () {
  const vaultName = (yield* ObsidianEnv).vaultName;
  const { basePath } = yield* VaultDisk;
  const { sourceId, databasePath } = yield* (yield* ZoteroPref).current;
  return {
    vault: { name: vaultName, path: basePath },
    source: { id: sourceId, databasePath },
  };
});
