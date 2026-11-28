import { makeQueryJobRunner } from "@zotlit/query-views/worker/item-query/job.ts";
import { serveZoteroReadsReplica } from "@zotlit/zotero-reads/desktop/serve-replica.ts";

serveZoteroReadsReplica(self, {
  queryJobs: makeQueryJobRunner({ meter: {} }),
});
