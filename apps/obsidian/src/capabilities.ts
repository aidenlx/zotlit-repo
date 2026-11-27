import { Effect, FileSystem, Layer } from "effect";
import citationParseWorker from "virtual:citation-parse-worker";

import {
  CitationParse,
  layerCitationParse,
} from "@zotlit/citations/obsidian/citation-parse/service.ts";
import { Workspace } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import { layerLibrarySourceActions } from "@zotlit/plugin-services/obsidian/library-source/actions.ts";
import { windowFocus } from "@zotlit/plugin-services/obsidian/library-source/focus.ts";
import {
  layerLibrarySource,
  LibrarySource,
} from "@zotlit/plugin-services/obsidian/library-source/service.ts";
import {
  keySecretControl,
  librarySourceItems,
  librarySourceRebuild,
} from "@zotlit/plugin-services/obsidian/library-source/settings-rows.ts";
import { ResourcePackPlatform } from "@zotlit/plugin-services/obsidian/managed-binary/pack-platform.ts";
import {
  defineFeature,
  registration,
  serviceGroup,
} from "@zotlit/plugin-shell/obsidian/feature.ts";
import { zoteroPageSlots } from "@zotlit/plugin-shell/obsidian/setting-pages/zotero.ts";
import {
  layerZoteroReads,
  ZoteroReads,
} from "@zotlit/zotero-reads/client/service.ts";

import { librarySourcePorts } from "./services/zotero-reads/library-source.ts";
import {
  layerZoteroReadsWebWorker,
  ZoteroReadsWebWorker,
} from "./services/zotero-reads/web-worker-client.ts";
import { workerClient } from "./services/zotero-reads/worker-client.ts";

export const desktopCapabilities = defineFeature({
  name: "desktop capabilities",
  services: [
    serviceGroup(
      "LibrarySource",
      {
        provides: [LibrarySource],
        requires: [ZoteroReadsWebWorker, ResourcePackPlatform, Workspace],
      },
      Layer.unwrap(
        Effect.map(
          librarySourcePorts((changes, open) => windowFocus(changes, open)),
          (ports) => layerLibrarySource(ports),
        ),
      ),
    ),
    serviceGroup(
      "ZoteroReads",
      {
        provides: [ZoteroReads],
        requires: [
          ResourcePackPlatform,
          FileSystem.FileSystem,
          ZoteroPref,
          LibrarySource,
        ],
      },
      layerZoteroReads(
        Effect.gen(function* () {
          const source = yield* LibrarySource;
          return source.reads ?? (yield* workerClient());
        }),
      ),
    ),
    serviceGroup(
      "ZoteroReadsWebWorker",
      { provides: [ZoteroReadsWebWorker], requires: [] },
      layerZoteroReadsWebWorker,
    ),
    serviceGroup(
      "CitationParse",
      { provides: [CitationParse], requires: [] },
      layerCitationParse(citationParseWorker),
    ),
  ],
  registrations: [
    registration("LibrarySourceActions", layerLibrarySourceActions),
  ],
  settingTab: {
    slots: {
      [zoteroPageSlots.source]: (ctx) => librarySourceItems(ctx),
    },
    rebuild: [librarySourceRebuild],
    controls: [keySecretControl],
  },
});
