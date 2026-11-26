import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";

import { readSegmenterFromPack } from "@zotlit/plugin-services/core/chinese-segmenter/pack-reader.ts";
import { queryJobRunner } from "@zotlit/query-views/desktop/item-query/job.ts";
import { prepareRead } from "@zotlit/zotero-reads/desktop/read-source.ts";
import { snapshotVerifier } from "@zotlit/zotero-reads/desktop/snapshot-integrity.ts";
import { snapshotRevision } from "@zotlit/zotero-reads/desktop/snapshot-revision.ts";
import { layerSource } from "@zotlit/zotero-reads/desktop/source.ts";
import { serveZoteroReads } from "@zotlit/zotero-reads/worker/serve.ts";

const verifySnapshot = snapshotVerifier(self.location.href);

serveZoteroReads(self, {
  connection: ({ config, snapshotOwner, deferOpen }) =>
    layerSource({
      initial: config,
      deferOpen,
      ports: {
        prepareRead: (mode, path) =>
          prepareRead(mode, path, { owner: snapshotOwner, verifySnapshot }),
      },
    }),
  handlers: {
    readSegmenter: readSegmenterFromPack,
    queryJobs: queryJobRunner,
    snapshotRevision,
  },
  fileSystem: NodeFileSystem.layer,
});
