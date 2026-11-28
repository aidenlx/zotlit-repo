import { fillMissing } from "@zotlit/plugin-kernel/worker/fills.ts";
import type { QueryMeter } from "@zotlit/query-views/worker/item-query/trace.ts";
import type { TEMPORAL_PIECE_URL_GLOBAL } from "@zotlit/zotero-reads/contract/web-worker.ts";

const webQueryMeter: QueryMeter = {};

const workerScope = self as unknown as {
  importScripts(...urls: string[]): void;
  close(): void;
  readonly [TEMPORAL_PIECE_URL_GLOBAL]: string;
};

void fillMissing(self, {
  temporal: () => workerScope.importScripts(workerScope.zotlitTemporalPiece),
})
  .then(async () => {
    const [{ serveZoteroReadsWeb }, { makeQueryJobRunner }] = await Promise.all(
      [
        import("@zotlit/zotero-reads/worker/serve-web.ts"),
        import("@zotlit/query-views/worker/item-query/job.ts"),
      ],
    );
    serveZoteroReadsWeb(self, {
      queryJobs: makeQueryJobRunner({ meter: webQueryMeter }),
    });
  })
  .catch((error: unknown) => {
    queueMicrotask(() => {
      throw error;
    });
    queueMicrotask(() => workerScope.close());
  });
