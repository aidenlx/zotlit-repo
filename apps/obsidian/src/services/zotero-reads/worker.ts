// Web Worker entry of the desktop plugin: ZoteroReads over the Zotero
// database clone that the desktop source opens. Obsidian runs workers with
// Node integration, so `node:sqlite` and `node:fs` load here through the
// worker's `require`.

import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";

import { readSegmenterFromPack } from "@zotlit/plugin-services/core/chinese-segmenter/pack-reader.ts";
import { queryJobRunner } from "@zotlit/query-views/desktop/item-query/job.ts";
import { prepareRead } from "@zotlit/zotero-reads/desktop/read-source.ts";
import { layerSource } from "@zotlit/zotero-reads/desktop/source.ts";
import { serveZoteroReads } from "@zotlit/zotero-reads/worker/serve.ts";

// Every read snapshot carries the owner tag the renderer sent. The worker's
// own runtime reaches the Node file system once, for the source's snapshot
// sweeps.
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
