import { nodeQueryMeter } from "./node-meter.ts";

import { makeQueryJobRunner } from "#worker/item-query/job.ts";

export const queryJobRunner = makeQueryJobRunner({
  meter: nodeQueryMeter,
  writesFiles: true,
});
