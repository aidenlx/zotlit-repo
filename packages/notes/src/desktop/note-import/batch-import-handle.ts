import type { Context } from "effect";
import { Effect } from "effect";

import type { EffectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";

import type {
  BatchImport,
  BatchImportPorts,
  BatchImportServices,
} from "./batch-import.ts";
import { reimportNoteByKey, runBatchImport } from "./batch-import.ts";

export function bindBatchImport(
  bridge: Pick<EffectBridge, "runPromise" | "runSync" | "runPromiseExit">,
  context: Context.Context<BatchImportServices>,
  ports: Omit<BatchImportPorts, "bridge">,
): BatchImport {
  const run = <A, E>(effect: Effect.Effect<A, E, BatchImportServices>) =>
    bridge.runPromise(Effect.provideContext(effect, context));
  const importPorts: BatchImportPorts = { ...ports, bridge };
  return {
    runBatchImport: (mode, itemIDs) =>
      run(runBatchImport(importPorts, { mode, itemIDs })),
    reimportNoteByKey: (noteKey, targetFile) =>
      run(reimportNoteByKey(importPorts, noteKey, targetFile)),
  };
}
