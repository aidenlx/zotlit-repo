import { FileSystem } from "effect";
import citationParseWorker from "virtual:citation-parse-worker";

import {
  CitationParse,
  layerCitationParse,
} from "@zotlit/citations/obsidian/citation-parse/service.ts";
// What only this host supplies: its two Worker bundles, built and embedded by
// its Vite config, and the ZoteroReads client that opens the Zotero database
// through one of them.
import { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import { ChineseSegmenter } from "@zotlit/plugin-services/obsidian/chinese-segmenter/service.ts";
import {
  defineFeature,
  serviceGroup,
} from "@zotlit/plugin-shell/obsidian/feature.ts";
import {
  layerZoteroReads,
  ZoteroReads,
} from "@zotlit/zotero-reads/client/service.ts";

import { workerClient } from "./services/zotero-reads/worker-client.ts";

export const desktopCapabilities = defineFeature({
  name: "desktop capabilities",
  services: [
    serviceGroup(
      "ZoteroReads",
      {
        provides: [ZoteroReads],
        requires: [ChineseSegmenter, FileSystem.FileSystem, ZoteroPref],
      },
      layerZoteroReads(workerClient()),
    ),
    serviceGroup(
      "CitationParse",
      { provides: [CitationParse], requires: [] },
      layerCitationParse(citationParseWorker),
    ),
  ],
});
