// What a host without Node supplies itself, as stubs: the platform's Zotero
// and file capabilities, which the desktop platform builds over Node, and the
// ports that only the features' desktop parts fill. The list is what ZotLit
// Mobile has to build in their place.
import { Effect, FileSystem, Layer, Stream } from "effect";
import type { Context } from "effect";

import { AnnotationNoteActions } from "@zotlit/annotations/obsidian/annot-view/note-actions.ts";
import { AnnotationViewReveal } from "@zotlit/annotations/obsidian/annot-view/view-reveal.ts";
import { ExcerptImageService } from "@zotlit/annotations/obsidian/excerpt-image/service.ts";
import { AnnotationPopover } from "@zotlit/citations/obsidian/annotation-popover/service.ts";
import { CitationParse } from "@zotlit/citations/obsidian/citation-parse/service.ts";
import { CitationPopover } from "@zotlit/citations/obsidian/citation-popover/service.ts";
import { CitekeyNoteActions } from "@zotlit/citations/obsidian/citekey-editor/note-actions.ts";
import { BibliographyRender } from "@zotlit/citations/obsidian/pandoc/render-cache.ts";
import { Release } from "@zotlit/library-view/obsidian/release/service.ts";
import { ItemMatchQuery } from "@zotlit/notes/core/profile-selection/item-matches.ts";
import { Profile } from "@zotlit/notes/obsidian/profile/service.ts";
import { TemplateWorkbenchLauncher } from "@zotlit/notes/obsidian/template/workbench-launcher.ts";
import { ShowInLibrary } from "@zotlit/obsidian-kit/show-in-library.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { ZoteroHttp } from "@zotlit/plugin-kernel/zotero-http.ts";
import { LocalServer } from "@zotlit/plugin-services/core/local-server/service.ts";
import { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import type { ZoteroPrefSnapshot } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import { defineFeature, serviceGroup } from "@zotlit/plugin-shell/obsidian/feature.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";

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

export const mobileCapabilities = defineFeature({
  name: "mobile capabilities",
  services: [
    // The platform's capabilities: no Zotero database, no prefs.js, no
    // listener, no file system.
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
    // The annotations' ports: the Excerpt Images read the file system, and
    // the note actions and the Annotation View live in the desktop parts.
    stub(ExcerptImageService),
    stub(AnnotationNoteActions),
    stub(AnnotationViewReveal, {
      cardShown: () => false,
      revealAnnotation: () => {},
    }),
    // The citations' ports: the parse Worker, the bibliography render over
    // the Zotero data folder, the popovers and the citekey editor's notes.
    stub(CitationParse),
    stub(BibliographyRender),
    stub(CitationPopover),
    stub(AnnotationPopover),
    stub(CitekeyNoteActions),
    // The notes' ports: the Profiles read the file system for their revision,
    // ZotLit Query matches them, and the workbench opens their documents.
    // A registry that never loads: no Profile document reads.
    stub(Profile, {
      state: Effect.die("unread"),
      changes: Stream.never,
      loaded: Effect.succeed(false),
    }),
    stub(ItemMatchQuery),
    stub(TemplateWorkbenchLauncher),
    // The Library View's: the Release check and Show in Library.
    stub(Release),
    stub(ShowInLibrary),
  ],
});
