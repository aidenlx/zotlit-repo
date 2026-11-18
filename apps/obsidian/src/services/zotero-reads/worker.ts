// Web Worker entry of the desktop plugin: ZoteroReads over the Zotero
// database clone that the desktop source opens. Obsidian runs workers with
// Node integration, so `node:sqlite` and `node:fs` load here through the
// worker's `require`.

import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";

import { readSegmenterFromOpfs } from "@zotlit/plugin-services/core/chinese-segmenter/opfs-reader.ts";
import { prepareRead } from "@zotlit/zotero-reads/desktop/read-source.ts";
import { layerSource } from "@zotlit/zotero-reads/desktop/source.ts";
import { serveZoteroReads } from "@zotlit/zotero-reads/worker/serve.ts";

import { queryJobRunner } from "@/services/item-query/job.ts";

// Every read snapshot carries the owner tag the renderer sent. The worker's
// own runtime reaches the Node file system once, for the source's snapshot
// sweeps.
serveZoteroReads(self, {
  connection: ({ config, snapshotOwner }) =>
    layerSource({
      initial: config,
      ports: {
        prepareRead: (mode, path) => prepareRead(mode, path, snapshotOwner),
      },
    }),
  handlers: { readSegmenter: readSegmenterFromOpfs, queryJobs: queryJobRunner },
  fileSystem: NodeFileSystem.layer,
});
