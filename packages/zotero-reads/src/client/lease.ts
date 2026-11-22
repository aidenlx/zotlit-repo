import { Cause, Exit, Scope } from "effect";

import type { EffectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { openScope } from "@zotlit/plugin-kernel/effect-scope.ts";

import type { ZoteroReadLease, ZoteroReads } from "./service.ts";

import { DbUnavailable } from "#contract/rpc.ts";

const leakedLeases = new FinalizationRegistry<() => Promise<void>>(
  (close) => void close(),
);

export async function acquireReadLease(
  reads: Pick<ZoteroReads["Service"], "snapshot">,
  bridge: Pick<EffectBridge, "runPromiseExit" | "closed">,
): Promise<ZoteroReadLease> {
  if (bridge.closed())
    throw new DbUnavailable({ message: "ZoteroReads is closed" });
  const { scope, close } = openScope();
  try {
    const exit = await bridge.runPromiseExit(
      Scope.provide(reads.snapshot, scope),
    );
    if (Exit.isFailure(exit)) {
      if (bridge.closed())
        throw new DbUnavailable({ message: "ZoteroReads is closed" });
      throw Cause.squash(exit.cause);
    }
    const snapshot = exit.value;
    const token = {};
    leakedLeases.register(snapshot, close, token);
    return {
      reads: snapshot,
      [Symbol.asyncDispose]: () => {
        leakedLeases.unregister(token);
        return close();
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}
