import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";

import { readSegmenterFromPack } from "@zotlit/plugin-services/core/chinese-segmenter/pack-reader.ts";
import { queryJobRunner } from "@zotlit/query-views/desktop/item-query/job.ts";
import { prepareRead } from "@zotlit/zotero-reads/desktop/read-source.ts";
import { layerSource } from "@zotlit/zotero-reads/desktop/source.ts";
import { serveZoteroReads } from "@zotlit/zotero-reads/worker/serve.ts";

serveZoteroReads(self, {
  connection: ({ config, snapshotOwner, deferOpen }) =>
    layerSource({
      initial: config,
      deferOpen,
      ports: {
        prepareRead: (mode, path) => prepareRead(mode, path, snapshotOwner),
      },
    }),
  handlers: { readSegmenter: readSegmenterFromPack, queryJobs: queryJobRunner },
  fileSystem: NodeFileSystem.layer,
});
