import { Context } from "effect";

import { HYDRATE_CHUNK_SIZE, SCAN_PAGE_SIZE } from "@zotlit/db/item-query";

export interface Tuning {
  readonly capRatio: number;
  readonly textSweepSparseRatio: number;
  readonly relationPageBudget: number;
  readonly scanPageSize: number;
  readonly hydrateChunkSize: number;
  readonly mergeStepSize: number;
  readonly forceScan: boolean;
}

export const PRODUCTION_TUNING: Tuning = {
  capRatio: 0.25,
  textSweepSparseRatio: 8,
  relationPageBudget: 8,
  scanPageSize: SCAN_PAGE_SIZE,
  hydrateChunkSize: HYDRATE_CHUNK_SIZE,
  mergeStepSize: 500,
  forceScan: false,
};

export const ItemQueryTuning = Context.Reference<Tuning>(
  "@zotlit/item-query/ItemQueryTuning",
  { defaultValue: () => PRODUCTION_TUNING },
);
