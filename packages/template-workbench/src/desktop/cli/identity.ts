import { Effect } from "effect";

import { ObsidianEnv } from "@zotlit/obsidian-kit/obsidian-env.ts";
import { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";

import type { WorkbenchIdentity } from "./envelope.ts";

export const readWorkbenchIdentity: Effect.Effect<
  WorkbenchIdentity,
  never,
  ObsidianEnv | ZoteroPref
> = Effect.gen(function* () {
  const env = yield* ObsidianEnv;
  const { sourceId, databasePath } = yield* (yield* ZoteroPref).current;
  return {
    vault: { name: env.vaultName, path: env.basePath },
    source: { id: sourceId, databasePath },
  };
});
