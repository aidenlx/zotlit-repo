import type { QueryMeter } from "#worker/item-query/trace.ts";
import { AsyncLocalStorage, createHook } from "node:async_hooks";

export const nodeQueryMeter: QueryMeter = {
  asyncContext: (hooks) => {
    const asyncJob = new AsyncLocalStorage<symbol>();
    const hook = createHook({
      init: (id, type) => hooks.init(id, type),
      before: (id) => hooks.before(id, asyncJob.getStore()),
      after: (id) => hooks.after(id),
      destroy: (id) => hooks.destroy(id),
    });
    return {
      current: () => asyncJob.getStore(),
      run: (job, evaluate) => asyncJob.run(job, evaluate),
      enable: () => {
        hook.enable();
      },
      disable: () => {
        hook.disable();
      },
    };
  },
  heapUsed: () => process.memoryUsage().heapUsed,
};
