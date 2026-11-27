import type { WorkbenchIdentity } from "#worker/cli/workbench-identity.ts";
import { Effect } from "effect";

import { ObsidianEnv } from "@zotlit/obsidian-kit/obsidian-env.ts";
import { VaultDisk } from "@zotlit/obsidian-kit/obsidian-vault-disk.ts";
import { readSourceIdentity } from "@zotlit/plugin-services/obsidian/library-source/identity.ts";
import type { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";

export const readWorkbenchIdentity: Effect.Effect<
  WorkbenchIdentity,
  never,
  ObsidianEnv | VaultDisk | ZoteroReads
> = Effect.gen(function* () {
  const vaultName = (yield* ObsidianEnv).vaultName;
  const { basePath } = yield* VaultDisk;
  const source = yield* readSourceIdentity;
  return { vault: { name: vaultName, path: basePath }, source };
});
