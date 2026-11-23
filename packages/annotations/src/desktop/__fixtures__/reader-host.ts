import { Effect, FileSystem, Layer, Stream } from "effect";
import type { Context } from "effect";

import { RELEASE_REPOSITORY } from "@zotlit/config/repositories";
import { ShowInLibrary } from "@zotlit/obsidian-kit/show-in-library.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { catalog } from "@zotlit/plugin-messages/catalog.ts";
import { runtime } from "@zotlit/plugin-messages/runtime.ts";
import { ZoteroHttp } from "@zotlit/plugin-kernel/zotero-http.ts";
import { LocalServer } from "@zotlit/plugin-services/core/local-server/service.ts";
import { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import type { ZoteroPrefSnapshot } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import {
  defineHost,
  settingsDefinitionOf,
} from "@zotlit/plugin-shell/obsidian/compose.ts";
import { defineFeature, serviceGroup } from "@zotlit/plugin-shell/obsidian/feature.ts";
import { platform } from "@zotlit/plugin-shell/obsidian/platform.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";

import { annotations } from "#desktop/feature.ts";

import { PdfTargetReader } from "#desktop/attachment-open/open-target.ts";
import { AnnotationNoteActions } from "#obsidian/annot-view/note-actions.ts";
import { AnnotationViewReveal } from "#obsidian/annot-view/view-reveal.ts";

const LOADING: ZoteroPrefSnapshot = {
  state: "loading",
  prefs: new Map(),
  resolvedProfileDir: null,
  profileDirOverride: null,
  dataDirOverride: null,
  dataDir: "/fixture/zotero",
  databasePath: "/fixture/zotero/zotero.sqlite",
  sourceId: null,
  acceptedSourceIds: [],
  baseAttachmentPath: null,
  httpPort: null,
};

const stub = <I, S extends object>(
  tag: Context.Key<I, S>,
  members: Partial<S> = {},
) =>
  serviceGroup(
    `stub ${tag.key}`,
    { provides: [tag] },
    Layer.succeed(tag, stubService<S>(tag.key, members)),
  );

export const readerCapabilities = defineFeature({
  name: "reader capabilities",
  services: [
    stub(ZoteroReads, {
      events: Stream.never,
      changes: Stream.never,
      reads: stubService("ZoteroReadsApi", {}),
    }),
    stub(FileSystem.FileSystem),
    stub(ZoteroPref, {
      current: Effect.succeed(LOADING),
      changes: Stream.never,
    }),
    stub(ZoteroHttp),
    stub(LocalServer, {
      available: Effect.succeed(false),
      availableChanges: Stream.never,
      effectivePort: Effect.succeed(null),
      effectivePortChanges: Stream.never,
      readerTarget: Effect.succeed(null),
      readerTargetChanges: Stream.never,
      readerClosed: Effect.succeed(true),
      readerClosedChanges: Stream.never,
      dbUpdated: Stream.never,
      updateManyRequests: Stream.never,
      importNotesRequests: Stream.never,
    }),
    stub(AnnotationNoteActions),
    stub(AnnotationViewReveal, {
      cardShown: () => false,
      revealAnnotation: () => {},
    }),
    stub(PdfTargetReader),
    stub(ShowInLibrary),
  ],
});

export const readerFeatures = [
  platform,
  readerCapabilities,
  annotations,
] as const;

export const readerHost = defineHost({
  features: readerFeatures,
  settings: { definition: settingsDefinitionOf(readerFeatures) },
  languagePack: {
    catalog,
    runtime,
    namespace: "zotlit",
    repository: RELEASE_REPOSITORY,
  },
  settingTab: { top: [], pages: ["reader"] },
  fileMenu: ["attachment-open", "annotation-history"],
  folderMenu: [],
});
