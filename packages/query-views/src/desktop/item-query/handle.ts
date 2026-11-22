import { valueOr } from "@zotlit/plugin-kernel/effect-bridge.ts";
import type { EffectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";

import type { QueryViewOutcome, QueryViewRequest } from "./query-view.ts";
import type { QueryService } from "./service.ts";

export interface QueryHandle {
  run(
    request: QueryViewRequest,
    signal: AbortSignal,
  ): Promise<QueryViewOutcome>;
  customFieldNames(signal: AbortSignal): Promise<readonly string[]>;
  on(event: "changed", callback: () => void): () => void;
  readonly viewRuns: number;
  readonly runningJobs: number;
}

export function bindQuery(
  bridge: Pick<EffectBridge, "runSync" | "runPromiseExit" | "subscribe">,
  query: QueryService["Service"],
): QueryHandle {
  return {
    run: (request, signal) =>
      bridge
        .runPromiseExit(query.run(request), { signal })
        .then((exit) => valueOr(exit, { kind: "cancelled" })),
    customFieldNames: (signal) =>
      bridge
        .runPromiseExit(query.customFieldNames, { signal })
        .then((exit) => valueOr(exit, [])),
    on: (_event, callback) => bridge.subscribe(query.changed, () => callback()),
    get viewRuns() {
      return bridge.runSync(query.viewRuns);
    },
    get runningJobs() {
      return bridge.runSync(query.runningJobs);
    },
  };
}
