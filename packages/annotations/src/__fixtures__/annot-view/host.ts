import { Effect, Layer, Scope, Stream } from "effect";
import type * as Atom from "effect/reactivity/Atom";
import { onTestFinished } from "vitest";

import { layerHost } from "@zotlit/obsidian-kit/__fixtures__/obsidian-host-app.ts";
import type { HostSources } from "@zotlit/obsidian-kit/__fixtures__/obsidian-host-app.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { openScope } from "@zotlit/plugin-kernel/effect-scope.ts";
import { makeViewRegistry } from "@zotlit/obsidian-kit/view-atoms.ts";
import type { ViewServices } from "@zotlit/obsidian-kit/view-atoms.ts";
import { CapabilityNotices } from "#obsidian/annotation-repository/notices.ts";
import { AnnotationRepository } from "#obsidian/annotation-repository/service.ts";
import { ExcerptDisplays } from "#desktop/excerpt-image/display.ts";
import type {
  ExcerptImageDisplay,
} from "#desktop/excerpt-image/display.ts";
import { DEFAULT_LIBRARY_SCOPE } from "@zotlit/zotero-reads/contract/library-scope.ts";
import { LibraryScope } from "@zotlit/plugin-services/obsidian/library-scope/service.ts";
import { LocalServer } from "@zotlit/plugin-services/core/local-server/service.ts";
import { AnnotationNoteActions } from "#obsidian/annot-view/note-actions.ts";
import { NoteIndex } from "@zotlit/plugin-services/obsidian/note-index/service.ts";
import { annotationReads } from "#__fixtures__/pdf-annotation-editor.ts";
import { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import type { ZoteroPrefSnapshot } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";
import {
  annotationDraftCommand,
  annotationWriteCommand,
  openExcerptDemandCommand,
  refreshExcerptDisplayCommand,
} from "#desktop/annot-view/atoms.ts";
import { createAnnotStore } from "#obsidian/annot-view/model.ts";

export const ANNOT_PATHS: ZoteroPrefSnapshot = {
  state: "ready",
  prefs: new Map(),
  resolvedProfileDir: null,
  profileDirOverride: null,
  dataDirOverride: null,
  dataDir: "/zotero",
  databasePath: "/zotero/zotero.sqlite",
  sourceId: null,
  baseAttachmentPath: null,
  httpPort: null,
};

export type AnnotHostOptions<R = never> = {
  annotations?: Partial<AnnotationRepository["Service"]>;
  holdCommands?: boolean;
  display?: Partial<ExcerptDisplays["Service"]>;
  notes?: Partial<AnnotationNoteActions["Service"]>;
  reads?: Partial<ZoteroReads["Service"]>;
  pref?: Partial<ZoteroPref["Service"]>;
  sources?: HostSources;
  services?: Layer.Layer<R>;
};

export function layerAnnotServices<R = never>(
  options: AnnotHostOptions<R> = {},
) {
  const absentImage: ExcerptImageDisplay = {
    image: null,
    current: false,
    status: "absent",
  };
  return Layer.mergeAll(
    Layer.mock(
      ExcerptDisplays,
      stubService<ExcerptDisplays["Service"]>("ExcerptDisplays", {
        open: Effect.succeed({
          demand: () => {},
          release: () => {},
          subscribe: () => () => {},
          snapshot: () => absentImage,
        }),
        refresh: Effect.void,
        ...options.display,
      }),
    ),
    Layer.mock(AnnotationNoteActions, {
      citation: () => Effect.succeed({ kind: "not-in-database" }),
      insert: () => Effect.succeed({ kind: "cancelled" }),
      ...options.notes,
    }),
    Layer.mock(CapabilityNotices, {
      allowEditing: Effect.void,
      reportBlockedGesture: () => Effect.void,
    }),
    Layer.mock(AnnotationRepository, {
      ...annotationReads(),
      ...options.annotations,
    }),
    Layer.mock(ZoteroReads, {
      reads: stubService<ZoteroReads["Service"]["reads"]>("ZoteroReadsApi", {}),
      current: Effect.succeed({
        state: "ready" as const,
        error: null,
        moved: false,
        dbFileMissing: false,
        activeReadMode: null,
      }),
      changes: Stream.succeed({
        state: "ready" as const,
        error: null,
        moved: false,
        dbFileMissing: false,
        activeReadMode: null,
      }),
      events: Stream.empty,
      ...options.reads,
    }),
    Layer.mock(ZoteroPref, {
      current: Effect.succeed(ANNOT_PATHS),
      changes: Stream.succeed(ANNOT_PATHS),
      ...options.pref,
    }),
    Layer.mock(LocalServer, {
      availableChanges: Stream.succeed(false),
      readerTargetChanges: Stream.succeed(null),
      readerClosedChanges: Stream.succeed(false),
    }),
    Layer.mock(LibraryScope, {
      changes: Stream.succeed({
        current: null,
        all: null,
        invalid: false,
        effective: DEFAULT_LIBRARY_SCOPE,
        libraryRows: [],
      }),
    }),
    Layer.mock(NoteIndex, {
      changes: Stream.empty,
      getNotesByItemKey: () => Effect.succeed([]),
    }),
    options.services ?? Layer.empty,
  );
}

export type UnreadViewServices = Exclude<
  ViewServices,
  | Layer.Success<ReturnType<typeof layerHost>>
  | Layer.Success<ReturnType<typeof layerAnnotServices<never>>>
>;

export function makeAnnotHost<R = never>(
  unread: Layer.Layer<UnreadViewServices>,
  options: AnnotHostOptions<R> = {},
) {
  const resource = openScope();
  const layer = Layer.mergeAll(
    unread,
    layerHost(options.sources),
    layerAnnotServices(options),
  );
  const context = Effect.runSync(
    Layer.build(layer).pipe(Effect.provideService(Scope.Scope, resource.scope)),
  );
  const registry = makeViewRegistry(context, { idleTTL: 0 });
  const commands: Atom.Atom<unknown>[] = [
    annotationDraftCommand,
    annotationWriteCommand,
    openExcerptDemandCommand,
    refreshExcerptDisplayCommand,
  ];
  if (options.holdCommands !== false)
    for (const command of commands) registry.mount(command);
  return {
    registry,
    openCards: () => createAnnotStore(registry),
    async [Symbol.asyncDispose]() {
      registry.dispose();
      await resource.close();
    },
  };
}

export function testAnnotHost<R = never>(
  unread: Layer.Layer<UnreadViewServices>,
  options: AnnotHostOptions<R> = {},
) {
  const host = makeAnnotHost(unread, options);
  onTestFinished(() => host[Symbol.asyncDispose]());
  return host;
}
