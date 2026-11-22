import type { DatabaseRowsError } from "#obsidian/annotation-repository/core/bridge.ts";
import type { AnnotationLibraryUnresolved } from "#obsidian/annotation-repository/core/lists.ts";
import type {
  AnnotationList,
  AnnotationRecord,
  AnnotationRepositoryCoreDeps,
  AnnotationRepositoryEvent,
  AnnotationSource,
  AnnotationState,
  TagDraft,
  TextFieldDraft,
} from "#obsidian/annotation-repository/core/model.ts";
import type {
  CreateOutcome,
  WriteReadError,
  WriteRunFailed,
} from "#obsidian/annotation-repository/core/writes.ts";
import {
  Clock,
  Context,
  Effect,
  FiberMap,
  FiberSet,
  Layer,
  PubSub,
  Stream,
} from "effect";

import { scopedBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import { filterTag, forkEach } from "@zotlit/plugin-kernel/effect-stream.ts";
import type { Held } from "@zotlit/plugin-services/core/query-client/service.ts";
import { QueryClients } from "@zotlit/plugin-services/core/query-client/service.ts";
import { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import { ZoteroLocalApi } from "@zotlit/plugin-services/obsidian/zotero-local-api/service.ts";
import { changed } from "@zotlit/zotero-reads/client/events.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";

import type { EditingCapability } from "./capability.ts";
import type { HistoryOutcome } from "./history.ts";
import type {
  AnnotationDraft,
  GeometryEdit,
  GeometryInput,
  MutationState,
  TextField,
} from "./write.ts";

import {
  annotationState,
  discardTagDraft,
  discardTextDraft,
  editTags,
  editTextField,
  holdUnsavableDrafts,
  retryTextDraft,
  submitTags,
  submitTextField,
  tagDraftFor,
  textDraftFor,
} from "#obsidian/annotation-repository/core/drafts.ts";
import {
  canRedo,
  canUndo,
  closeHistory,
  openHistory,
  redo,
  undo,
} from "#obsidian/annotation-repository/core/history-steps.ts";
import {
  capability,
  capabilityFor,
  dropDatabasePartition,
  hold,
  inRepository,
  peek,
  read,
  refresh,
  refreshLocks,
  sourceMoved,
} from "#obsidian/annotation-repository/core/lists.ts";
import { mutationFor } from "#obsidian/annotation-repository/core/outcomes.ts";
import { CoreState } from "#obsidian/annotation-repository/core/state.ts";
import {
  createAnnotation,
  deleteAnnotation,
  deleteAnnotations,
  discardConflict,
  patchColor,
  patchColors,
  patchComment,
  patchGeometry,
  retryWrite,
} from "#obsidian/annotation-repository/core/writes.ts";
import { savedExcerptRequestFor } from "#obsidian/excerpt-image/request.ts";
import { ExcerptImageService } from "#obsidian/excerpt-image/service.ts";

export type {
  CreateOutcome,
  WriteReadError,
} from "#obsidian/annotation-repository/core/writes.ts";
export { WriteRunFailed } from "#obsidian/annotation-repository/core/writes.ts";
export {
  UNHELD_RETENTION,
  AnnotationLibraryUnresolved,
} from "#obsidian/annotation-repository/core/lists.ts";
export type {
  DatabaseAnnotationSource,
  AnnotationSource,
  AnnotationRecord,
  AnnotationList,
  TextFieldDraft,
  TagDraft,
  AnnotationState,
  AnnotationRepositoryEvent,
} from "#obsidian/annotation-repository/core/model.ts";
export type { EditingCapability } from "./capability.ts";
export type { LockReason } from "#core/annotation-repository/lock.ts";
export type { HistoryDirection, HistoryOutcome } from "./history.ts";
export type {
  AnnotationDraft,
  GeometryEdit,
  GeometryInput,
  MutationState,
  TextField,
  WriteConflict,
} from "./write.ts";
export type { DatabaseRowsError } from "#obsidian/annotation-repository/core/bridge.ts";

export type AnnotationRepositoryShape = {
  read(
    attachmentKey: string,
  ): Effect.Effect<
    AnnotationList | null,
    DatabaseRowsError | AnnotationLibraryUnresolved
  >;
  hold(attachmentKeys: Iterable<string>): Effect.Effect<Disposable>;
  refresh(attachmentKey: string): Effect.Effect<AnnotationList | null>;
  peek(attachmentKey: string): Effect.Effect<Held<AnnotationList> | null>;
  capabilityFor(attachmentKey: string): Effect.Effect<EditingCapability>;
  readonly capability: Effect.Effect<EditingCapability>;
  readonly probe: Effect.Effect<void>;
  mutationFor(annotationKey: string): Effect.Effect<MutationState>;
  annotationState(annotationKey: string): Effect.Effect<AnnotationState>;
  textDraftFor(
    field: TextField,
    annotationKey: string,
  ): Effect.Effect<TextFieldDraft | null>;
  editTextField(
    field: TextField,
    annotationKey: string,
    text?: string,
  ): Effect.Effect<TextFieldDraft | null>;
  submitTextField(
    field: TextField,
    annotationKey: string,
    options?: { automatic?: boolean },
  ): Effect.Effect<MutationState, WriteRunFailed>;
  discardTextDraft(
    field: TextField,
    annotationKey: string,
  ): Effect.Effect<void>;
  retryTextDraft(
    field: TextField,
    annotationKey: string,
  ): Effect.Effect<MutationState, WriteRunFailed>;
  tagDraftFor(annotationKey: string): Effect.Effect<TagDraft | null>;
  editTags(
    annotationKey: string,
    names?: readonly string[],
  ): Effect.Effect<TagDraft | null>;
  submitTags(
    annotationKey: string,
    options?: { automatic?: boolean },
  ): Effect.Effect<MutationState, WriteRunFailed>;
  discardTagDraft(annotationKey: string): Effect.Effect<void>;
  createAnnotation(
    attachmentKey: string,
    draft: Omit<AnnotationDraft, "parentKey">,
    options?: { group?: string },
  ): Effect.Effect<CreateOutcome, WriteReadError>;
  patchColor(
    annotationKey: string,
    color: string,
  ): Effect.Effect<MutationState, WriteRunFailed>;
  patchColors(
    annotationKeys: readonly string[],
    color: string,
  ): Effect.Effect<MutationState[]>;
  patchComment(
    annotationKey: string,
    comment: string,
  ): Effect.Effect<MutationState, WriteRunFailed>;
  patchGeometry(
    annotationKey: string,
    edit: GeometryEdit,
    input: GeometryInput,
  ): Effect.Effect<MutationState, WriteRunFailed>;
  deleteAnnotation(
    annotationKey: string,
  ): Effect.Effect<MutationState, WriteRunFailed>;
  deleteAnnotations(
    annotationKeys: readonly string[],
  ): Effect.Effect<MutationState[]>;
  retryWrite(
    annotationKey: string,
  ): Effect.Effect<MutationState, WriteRunFailed>;
  discardConflict(annotationKey: string): Effect.Effect<void>;
  openHistory(attachmentKey: string): Effect.Effect<void>;
  closeHistory(attachmentKey: string): Effect.Effect<void>;
  canUndo(attachmentKey: string): Effect.Effect<boolean>;
  canRedo(attachmentKey: string): Effect.Effect<boolean>;
  undo(
    attachmentKey: string,
  ): Effect.Effect<HistoryOutcome, WriteRunFailed | WriteReadError>;
  redo(
    attachmentKey: string,
  ): Effect.Effect<HistoryOutcome, WriteRunFailed | WriteReadError>;
  readonly annotationsChanged: Stream.Stream<string>;
  readonly excerptPixelsChanged: Stream.Stream<{
    record: AnnotationRecord;
    source: AnnotationSource;
  }>;
  readonly capabilityChanges: Stream.Stream<void>;
  readonly annotationChanged: Stream.Stream<string>;
  readonly historyChanged: Stream.Stream<string>;
  readonly writeConflicts: Stream.Stream<{
    annotationKey: string;
    attachmentKey: string;
  }>;
};

export class AnnotationRepository extends Context.Service<
  AnnotationRepository,
  AnnotationRepositoryShape
>()("zotlit/annotation-repository/AnnotationRepository") {}

export function layerAnnotationRepository(options: {
  readonly writeToken?: () => string;
}): Layer.Layer<
  AnnotationRepository,
  never,
  ExcerptImageService | ZoteroReads | QueryClients | ZoteroLocalApi | ZoteroPref
> {
  return Layer.effect(
    AnnotationRepository,
    Effect.gen(function* () {
      const images = yield* ExcerptImageService;
      const reads = yield* ZoteroReads;
      const queries = yield* QueryClients;
      const api = yield* ZoteroLocalApi;
      const pref = yield* ZoteroPref;
      const clock = yield* Clock.Clock;
      const bridge = yield* scopedBridge;
      const bus = yield* PubSub.unbounded<AnnotationRepositoryEvent>();
      yield* Effect.addFinalizer(() => PubSub.shutdown(bus));
      const persistedExcerpt: AnnotationRepositoryCoreDeps["persistedExcerpt"] =
        Effect.fnUntraced(function* (annotation, source) {
          const request = yield* savedExcerptRequestFor({
            annotation,
            source,
          }).pipe(
            Effect.provideService(ZoteroReads, reads),
            Effect.provideService(ZoteroPref, pref),
          );
          if (!request) return null;
          const stored = yield* images.stored(request);
          return stored?.identity.fingerprint ?? null;
        });
      const fibers = yield* FiberSet.make();
      const refreshes = yield* FiberMap.make<
        string,
        AnnotationList | null,
        never
      >();
      const idleSaves = yield* FiberMap.make<string>();
      const burstSaves = yield* FiberMap.make<string>();
      const shared = new CoreState(
        {
          bridge,
          db: reads,
          queryClient: queries,
          localApi: api,
          publish: (event) => {
            void PubSub.publishUnsafe(bus, event);
          },
          writeToken: options.writeToken,
          persistedExcerpt,
        },
        { fibers, refreshes, idleSaves, burstSaves },
      );
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          shared.commandGeneration += 1;
        }),
      );
      yield* forkEach(changed(reads), () =>
        Effect.andThen(
          dropDatabasePartition(shared),
          FiberSet.run(fibers, refreshLocks(shared)),
        ),
      );
      yield* forkEach(api.changes, () => sourceMoved(shared));
      yield* forkEach(api.capabilityChanges, () => holdUnsavableDrafts(shared));
      const onLayerClock = Effect.provideService(Clock.Clock, clock);
      const events = Stream.fromPubSub(bus);
      const byTag = <T extends AnnotationRepositoryEvent["_tag"]>(tag: T) =>
        filterTag(events, tag);
      return AnnotationRepository.of({
        read: Effect.fn("AnnotationRepository.read")((attachmentKey) =>
          read(shared, attachmentKey).pipe(inRepository, onLayerClock),
        ),
        hold: Effect.fn("AnnotationRepository.hold")((attachmentKeys) =>
          hold(shared, attachmentKeys),
        ),
        refresh: Effect.fn("AnnotationRepository.refresh")((attachmentKey) =>
          refresh(shared, attachmentKey).pipe(inRepository, onLayerClock),
        ),
        peek: Effect.fn("AnnotationRepository.peek")((attachmentKey) =>
          Effect.sync(() => peek(shared, attachmentKey)),
        ),
        capabilityFor: Effect.fn("AnnotationRepository.capabilityFor")(
          (attachmentKey) =>
            capabilityFor(shared, attachmentKey).pipe(
              inRepository,
              onLayerClock,
            ),
        ),
        capability: capability(shared).pipe(inRepository, onLayerClock),
        probe: api.probe.pipe(Effect.withSpan("AnnotationRepository.probe")),
        mutationFor: Effect.fn("AnnotationRepository.mutationFor")(
          (annotationKey) =>
            Effect.sync(() => mutationFor(shared, annotationKey)),
        ),
        annotationState: Effect.fnUntraced(function* (annotationKey) {
          return yield* annotationState(shared, annotationKey).pipe(
            inRepository,
            onLayerClock,
          );
        }),
        textDraftFor: Effect.fnUntraced(function* (field, annotationKey) {
          return yield* textDraftFor(shared, field, annotationKey).pipe(
            inRepository,
            onLayerClock,
          );
        }),
        editTextField: Effect.fn("AnnotationRepository.editTextField")(
          (field, annotationKey, text) =>
            editTextField(shared, field, { annotationKey, text }).pipe(
              inRepository,
              onLayerClock,
            ),
        ),
        submitTextField: Effect.fn("AnnotationRepository.submitTextField")(
          (field, annotationKey, writeOptions) =>
            submitTextField(shared, field, {
              annotationKey,
              ...writeOptions,
            }).pipe(inRepository, onLayerClock),
        ),
        discardTextDraft: Effect.fn("AnnotationRepository.discardTextDraft")(
          (field, annotationKey) =>
            discardTextDraft(shared, field, annotationKey).pipe(
              inRepository,
              onLayerClock,
            ),
        ),
        retryTextDraft: Effect.fn("AnnotationRepository.retryTextDraft")(
          (field, annotationKey) =>
            retryTextDraft(shared, field, annotationKey).pipe(
              inRepository,
              onLayerClock,
            ),
        ),
        tagDraftFor: Effect.fnUntraced(function* (annotationKey) {
          return yield* tagDraftFor(shared, annotationKey).pipe(
            inRepository,
            onLayerClock,
          );
        }),
        editTags: Effect.fn("AnnotationRepository.editTags")(
          (annotationKey, names) =>
            editTags(shared, annotationKey, names).pipe(
              inRepository,
              onLayerClock,
            ),
        ),
        submitTags: Effect.fn("AnnotationRepository.submitTags")(
          (annotationKey, writeOptions) =>
            submitTags(shared, annotationKey, writeOptions).pipe(
              inRepository,
              onLayerClock,
            ),
        ),
        discardTagDraft: Effect.fn("AnnotationRepository.discardTagDraft")(
          (annotationKey) =>
            discardTagDraft(shared, annotationKey).pipe(
              inRepository,
              onLayerClock,
            ),
        ),
        createAnnotation: Effect.fn("AnnotationRepository.createAnnotation")(
          (attachmentKey, draft, createOptions) =>
            createAnnotation(shared, attachmentKey, {
              draft,
              ...createOptions,
            }).pipe(inRepository, onLayerClock),
        ),
        patchColor: Effect.fn("AnnotationRepository.patchColor")(
          (annotationKey, color) =>
            patchColor(shared, annotationKey, color).pipe(
              inRepository,
              onLayerClock,
            ),
        ),
        patchColors: Effect.fn("AnnotationRepository.patchColors")(
          (annotationKeys, color) =>
            patchColors(shared, annotationKeys, color).pipe(
              inRepository,
              onLayerClock,
            ),
        ),
        patchComment: Effect.fn("AnnotationRepository.patchComment")(
          (annotationKey, comment) =>
            patchComment(shared, annotationKey, comment).pipe(
              inRepository,
              onLayerClock,
            ),
        ),
        patchGeometry: Effect.fn("AnnotationRepository.patchGeometry")(
          (annotationKey, edit, input) =>
            patchGeometry(shared, annotationKey, { edit, input }).pipe(
              inRepository,
              onLayerClock,
            ),
        ),
        deleteAnnotation: Effect.fn("AnnotationRepository.deleteAnnotation")(
          (annotationKey) =>
            deleteAnnotation(shared, annotationKey).pipe(
              inRepository,
              onLayerClock,
            ),
        ),
        deleteAnnotations: Effect.fn("AnnotationRepository.deleteAnnotations")(
          (annotationKeys) =>
            deleteAnnotations(shared, annotationKeys).pipe(
              inRepository,
              onLayerClock,
            ),
        ),
        retryWrite: Effect.fn("AnnotationRepository.retryWrite")(
          (annotationKey) =>
            retryWrite(shared, annotationKey).pipe(inRepository, onLayerClock),
        ),
        discardConflict: Effect.fn("AnnotationRepository.discardConflict")(
          (annotationKey) =>
            discardConflict(shared, annotationKey).pipe(
              inRepository,
              onLayerClock,
            ),
        ),
        openHistory: Effect.fn("AnnotationRepository.openHistory")(
          (attachmentKey) =>
            openHistory(shared, attachmentKey).pipe(inRepository, onLayerClock),
        ),
        closeHistory: Effect.fn("AnnotationRepository.closeHistory")(
          (attachmentKey) =>
            closeHistory(shared, attachmentKey).pipe(
              inRepository,
              onLayerClock,
            ),
        ),
        canUndo: Effect.fn("AnnotationRepository.canUndo")((attachmentKey) =>
          canUndo(shared, attachmentKey).pipe(inRepository, onLayerClock),
        ),
        canRedo: Effect.fn("AnnotationRepository.canRedo")((attachmentKey) =>
          canRedo(shared, attachmentKey).pipe(inRepository, onLayerClock),
        ),
        undo: Effect.fn("AnnotationRepository.undo")((attachmentKey) =>
          undo(shared, attachmentKey).pipe(inRepository, onLayerClock),
        ),
        redo: Effect.fn("AnnotationRepository.redo")((attachmentKey) =>
          redo(shared, attachmentKey).pipe(inRepository, onLayerClock),
        ),
        annotationsChanged: byTag("annotations-changed").pipe(
          Stream.map(({ attachmentKey }) => attachmentKey),
        ),
        excerptPixelsChanged: byTag("excerpt-pixels-changed").pipe(
          Stream.map(({ record, source }) => ({ record, source })),
        ),
        capabilityChanges: byTag("capability-changed").pipe(
          Stream.as(undefined),
        ),
        annotationChanged: byTag("annotation-changed").pipe(
          Stream.map(({ annotationKey }) => annotationKey),
        ),
        historyChanged: byTag("history-changed").pipe(
          Stream.map(({ attachmentKey }) => attachmentKey),
        ),
        writeConflicts: byTag("write-conflict").pipe(
          Stream.map(({ annotationKey, attachmentKey }) => ({
            annotationKey,
            attachmentKey,
          })),
        ),
      });
    }).pipe(Effect.orDie, withLogCategory("annotation-repository")),
  );
}

declare module "@zotlit/obsidian-kit/view-atoms.ts" {
  interface ViewServiceRegistry {
    AnnotationRepository: AnnotationRepository;
  }
}
