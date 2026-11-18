// A second host for the shell: the platform and the annotations only, as a
// PDF reader app would compose them, with a stub for each port the
// annotations read and no other feature fills. The host type-checks only
// while that stub list is complete, so a new port the annotations start to
// read shows here first.
import { Effect, FileSystem, Layer, Stream } from "effect";
import type { Context } from "effect";

import { ShowInLibrary } from "@zotlit/obsidian-kit/show-in-library.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
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

/** A Zotero data directory that is still loading. */
const LOADING: ZoteroPrefSnapshot = {
  state: "loading",
  prefs: new Map(),
  resolvedProfileDir: null,
  profileDirOverride: null,
  dataDirOverride: null,
  dataDir: "/fixture/zotero",
  databasePath: "/fixture/zotero/zotero.sqlite",
  sourceId: null,
  baseAttachmentPath: null,
  httpPort: null,
};

/** A group that fills `tag` with a stub holding only `members`. */
const stub = <I, S extends object>(
  tag: Context.Key<I, S>,
  members: Partial<S> = {},
) =>
  serviceGroup(
    `stub ${tag.key}`,
    { provides: [tag] },
    Layer.succeed(tag, stubService<S>(tag.key, members)),
  );

/**
 * What a reader host supplies itself. The Zotero reads stand for the
 * ZoteroReads client contract; the desktop platform's Zotero and file
 * capabilities and the ports of the notes, the query views and the Library
 * View stand for what such a host would build in their place.
 */
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
    // A port that is never open: no reader, no Zotero pushes.
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
    // No Annotation View: a card is never shown, and a reveal does nothing.
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
  settingTab: { top: [], pages: ["reader"] },
  fileMenu: ["attachment-open", "annotation-history"],
  folderMenu: [],
});
