import type { ReaderSession } from "#core/reader-session/session.ts";
import type {
  BorrowedExcerptDocument,
  ExcerptReaderDocuments,
} from "#obsidian/excerpt-image/reader-borrow.ts";
import {
  Clock,
  Context,
  Effect,
  Exit,
  FiberSet,
  Layer,
  PubSub,
  Scope,
  Stream,
  SubscriptionRef,
} from "effect";
import type { TFile, View } from "obsidian";

import type { ParsedAnnotationSubpath } from "@zotlit/db";
import { attachmentPathKey } from "@zotlit/db/path";
import { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import { ObsidianEnv } from "@zotlit/obsidian-kit/obsidian-env.ts";
import { VaultDisk } from "@zotlit/obsidian-kit/obsidian-vault-disk.ts";
import { Workspace } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import { scopedBridge, valueOr } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import { forkEach } from "@zotlit/plugin-kernel/effect-stream.ts";
import {
  fromInstant,
  instantClock,
} from "@zotlit/plugin-kernel/worker/effect-clock.ts";
import { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import { AttachmentResolver } from "@zotlit/plugin-services/obsidian/attachment-resolver/service.ts";
import { libraryTagNames } from "@zotlit/plugin-services/obsidian/database/library-tag-names.ts";
import { NoteIndex } from "@zotlit/plugin-services/obsidian/note-index/service.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import { UseLedger } from "@zotlit/plugin-services/obsidian/use-ledger/service.ts";
import { writeReadUse } from "@zotlit/plugin-services/obsidian/zotero-local-api/last-read.ts";
import { ZoteroLocalApi } from "@zotlit/plugin-services/obsidian/zotero-local-api/service.ts";
import type { ReaderExtension, ReaderHostContext } from "@zotlit/reader-api";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";

import { PdfViewBinding } from "./binding.ts";
import type { HostedReader } from "./hosted-reader.ts";
import { bindingResources } from "./operations.ts";
import type { MarkGestures } from "./selection.ts";
import { toolColorStore } from "./tools.ts";

import { PdfReads } from "#core/pdf-annotation-editor/reads.ts";
import { AnnotationNoteActions } from "#obsidian/annot-view/note-actions.ts";
import { CapabilityNotices } from "#obsidian/annotation-repository/notices.ts";
import { AnnotationRepository } from "#obsidian/annotation-repository/service.ts";
import { anchorIn } from "#obsidian/pdf-reader/viewer.ts";
import {
  ReaderConnection,
  whileConnected,
} from "#obsidian/reader-connection/service.ts";

export type { AttachmentResolution } from "@zotlit/plugin-services/obsidian/attachment-resolver/service.ts";
export type {
  ReaderSession,
  ReaderSessionTarget,
} from "#core/reader-session/session.ts";
export type {
  AnnotationReads,
  AttachmentReads,
  CapabilityGestures,
  PdfViewBinding,
} from "./binding.ts";
export type { MarkGestures } from "./selection.ts";

export interface PdfAnnotationEditorPorts {
  revealAnnotation: MarkGestures["revealAnnotation"];
  blockedPress: (
    block: Parameters<MarkGestures["blockedPress"]>[0],
    showCapability: () => void,
  ) => void;
  readers: ExcerptReaderDocuments;
}

export class PdfAnnotationEditor extends Context.Service<
  PdfAnnotationEditor,
  {
    readonly extension: ReaderExtension<ReaderHostContext>;
    readonly bindings: Effect.Effect<readonly PdfViewBinding[]>;
    readonly sessions: Stream.Stream<ReadonlyMap<View, ReaderSession>>;
    bindingFor(
      view: View | null | undefined,
    ): Effect.Effect<PdfViewBinding | null>;
    sessionFor(
      view: View | null | undefined,
    ): Effect.Effect<ReaderSession | null>;
    borrowDocument(
      absolutePath: string,
    ): Effect.Effect<BorrowedExcerptDocument | null>;
    readonly sessionAdded: Stream.Stream<string>;
  }
>()("zotlit/pdf-annotation-editor/PdfAnnotationEditor") {}

export const layerPdfAnnotationEditor = (ports: PdfAnnotationEditorPorts) =>
  Layer.effect(
    PdfAnnotationEditor,
    Effect.gen(function* () {
      const workspace = yield* Workspace;
      const disk = yield* VaultDisk;
      const attachments = yield* AttachmentResolver;
      const annotations = yield* AnnotationRepository;
      const noteIndex = yield* NoteIndex;
      const settings = yield* PluginSettings;
      const ledger = yield* UseLedger;
      const zoteroReads = yield* ZoteroReads;
      const api = yield* ZoteroLocalApi;
      const notices = yield* CapabilityNotices;
      const notifier = yield* Notifier;
      const annotationNotes = yield* AnnotationNoteActions;
      const zoteroPref = yield* ZoteroPref;
      const { os } = yield* ObsidianEnv;
      const connection = yield* ReaderConnection;
      const bridge = yield* scopedBridge;
      const layerScope = yield* Effect.scope;
      const now = instantClock(yield* Clock.Clock);
      const events = yield* PubSub.unbounded<string>();
      const sessions = yield* SubscriptionRef.make<
        ReadonlyMap<View, ReaderSession>
      >(new Map());
      yield* Effect.addFinalizer(() => PubSub.shutdown(sessions.pubsub));
      yield* Effect.addFinalizer(() => PubSub.shutdown(events));
      const bindings = new Map<View, PdfViewBinding>();
      const scopes = new Map<PdfViewBinding, Scope.Closeable>();
      let trackOpens = false;
      let retired = false;
      const colors = toolColorStore(settings, bridge);
      const reads = new PdfReads({
        now,
        record: ({ attachmentKey, itemKey, serverID, instant }) => {
          bridge.runSync(ledger.record(itemKey, "read", fromInstant(instant)));
          void bridge.runPromiseExit(
            writeReadUse({
              attachmentKey,
              serverID,
              instant: fromInstant(instant),
            }).pipe(
              Effect.provideService(ZoteroReads, zoteroReads),
              Effect.provideService(ZoteroLocalApi, api),
            ),
          );
        },
      });
      const showCapability = () =>
        bridge.runAndForget(notices.showEditingCapability);
      const publishSessions = Effect.suspend(() =>
        SubscriptionRef.set(
          sessions,
          new Map(
            [...bindings].map(([view, binding]) => [view, binding.session]),
          ),
        ),
      );
      const bindingScopes = yield* Scope.fork(layerScope);
      const connectionScopes = yield* Scope.fork(layerScope);
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          retired = true;
          bindings.clear();
          scopes.clear();
        }),
      );
      const unbind = Effect.fnUntraced(function* (
        view: View,
        binding: PdfViewBinding,
        { unloading }: { unloading: boolean },
      ) {
        if (trackOpens && !unloading) binding.close();
        if (bindings.get(view) === binding) bindings.delete(view);
        const scope = scopes.get(binding);
        scopes.delete(binding);
        if (scope)
          yield* Scope.close(scope, Exit.void).pipe(
            Effect.forkIn(layerScope, { startImmediately: true }),
          );
      });
      const bind = Effect.fnUntraced(function* (
        view: View,
        reader: HostedReader,
        {
          file,
          restored,
          anchor,
        }: {
          file: TFile;
          restored: boolean;
          anchor: ParsedAnnotationSubpath | null;
        },
      ) {
        const scope = yield* Scope.fork(bindingScopes);
        const { registry, writes } = yield* bindingResources.pipe(
          Scope.provide(scope),
        );
        const runInsert = yield* FiberSet.make().pipe(
          Effect.flatMap((fibers) => FiberSet.runtime(fibers)<never>()),
          Scope.provide(scope),
        );
        const binding = new PdfViewBinding({
          view,
          file,
          reader,
          fullPath: (path) => bridge.runSync(disk.fullPath(path)),
          attachments,
          annotations,
          bridge,
          writes,
          notifier,
          capabilityGestures: {
            reportBlockedGesture: (key) =>
              bridge.runAndForget(notices.reportBlockedGesture(key)),
            allowEditing: showCapability,
          },
          markGestures: {
            revealAnnotation: ports.revealAnnotation,
            blockedPress: (block) => ports.blockedPress(block, showCapability),
          },
          toolColors: colors,
          noteIndex,
          libraryTagNames: async (key) =>
            valueOr(
              await bridge.runPromiseExit(libraryTagNames(zoteroReads, key)),
              [],
            ),
          now,
          reads,
          openedAt: restored ? null : now(),
          anchor,
          registry,
          inserts: {
            execute: (request) => annotationNotes.insert(request),
            run: runInsert,
          },
          sourceScope: () => bridge.runSync(zoteroPref.current).dataDir,
        });
        yield* Scope.addFinalizer(
          scope,
          Effect.sync(() => binding[Symbol.dispose]()),
        );
        bindings.set(view, binding);
        scopes.set(binding, scope);
        binding.load();
        if (binding.filePath) yield* PubSub.publish(events, binding.filePath);
        yield* publishSessions;
        return binding;
      });
      const run = Effect.runSyncWith(yield* Effect.context<never>());
      const extension: ReaderExtension<ReaderHostContext> = {
        id: "zotlit-annotation-editor",
        kinds: ["view"],
        attach: ({ reader, host, subpath: mounted }) => {
          const { view, file } = host;
          if (retired || view === null) return;
          let binding = run(
            bind(view, reader, {
              file,
              restored: host.restored,
              anchor: mounted ? anchorIn(mounted.raw) : null,
            }),
          );
          let attached = false;
          const offReady = reader.on("ready", () => {
            if (attached || retired) return;
            attached = true;
            binding.attachDocument();
          });
          if (reader.document.get() !== null) {
            attached = true;
            binding.attachDocument();
          }
          const offSubpath = reader.on("subpath", ({ subpath }) => {
            if (retired) return;
            const anchor = anchorIn(subpath.raw);
            binding.aim(anchor);
            if (anchor === null) return;
            if (!binding.renamed) {
              binding.land();
              return;
            }
            run(
              Effect.logDebug(
                "An open named another Attachment of the bound file",
              ).pipe(
                withLogCategory("pdf-annotation-editor"),
                Effect.annotateLogs({
                  path: binding.filePath,
                  bound: binding.historyAttachment,
                }),
              ),
            );
            run(unbind(view, binding, { unloading: false }));
            binding = run(
              bind(view, reader, { file, restored: false, anchor }),
            );
            if (attached) binding.attachDocument();
          });
          return {
            [Symbol.dispose]: () => {
              offReady();
              offSubpath();
              if (!retired)
                run(
                  unbind(view, binding, { unloading: host.unloading() }).pipe(
                    Effect.andThen(publishSessions),
                  ),
                );
            },
          };
        },
      };
      const bindingFor = Effect.fn("PdfAnnotationEditor.bindingFor")(
        (view: View | null | undefined) =>
          Effect.sync(() => (view ? (bindings.get(view) ?? null) : null)),
      );
      const borrowDocument = Effect.fn("PdfAnnotationEditor.borrowDocument")(
        (absolutePath: string) =>
          Effect.sync(() => {
            const key = attachmentPathKey(absolutePath, os);
            for (const binding of bindings.values()) {
              if (
                binding.absolutePath !== null &&
                attachmentPathKey(binding.absolutePath, os) === key
              )
                return binding.borrow();
            }
            return null;
          }),
      );
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          ports.readers.borrow = (path) => run(borrowDocument(path));
        }),
        () =>
          Effect.sync(() => {
            ports.readers.borrow = () => null;
          }),
      );
      yield* whileConnected(connection, connectionScopes, (api) =>
        Effect.acquireRelease(
          Effect.sync(() => api.addExtension(extension)),
          (remove) => Effect.sync(remove),
        ),
      );
      yield* forkEach(workspace.changes, (event) => {
        if (event._tag === "active-leaf-change") {
          for (const binding of bindings.values()) binding.placePopup();
          if (event.leaf) bindings.get(event.leaf.view)?.activate();
        }
      });
      yield* workspace.layoutReady.pipe(
        Effect.andThen(
          Effect.sync(() => {
            trackOpens = true;
          }),
        ),
        Effect.forkScoped({ startImmediately: true }),
      );
      return PdfAnnotationEditor.of({
        extension,
        bindings: Effect.sync(() => [...bindings.values()]).pipe(
          Effect.withSpan("PdfAnnotationEditor.bindings"),
        ),
        sessions: SubscriptionRef.changes(sessions),
        bindingFor,
        sessionFor: Effect.fn("PdfAnnotationEditor.sessionFor")((view) =>
          Effect.map(bindingFor(view), (binding) => binding?.session ?? null),
        ),
        borrowDocument,
        sessionAdded: Stream.fromPubSub(events),
      });
    }),
  );

declare module "@zotlit/obsidian-kit/view-atoms.ts" {
  interface ViewServiceRegistry {
    PdfAnnotationEditor: PdfAnnotationEditor;
  }
}
