import { ANNOTATIONS, ATTACHMENTS, ITEMS } from "@zotlit/item-query";
import type { QueryDataset } from "@zotlit/item-query";

import type { QueryDatasetId } from "./worker-protocol.ts";

export interface CliDataset {
  readonly dataset: QueryDataset;
}

export const CLI_DATASETS: Readonly<Record<QueryDatasetId, CliDataset>> = {
  items: { dataset: ITEMS },
  attachments: { dataset: ATTACHMENTS },
  annotations: { dataset: ANNOTATIONS },
};
