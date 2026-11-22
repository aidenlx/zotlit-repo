import type { AnnotationLock } from "#core/annotation-repository/lock.ts";
import type { AnnotationHistory } from "#obsidian/annotation-repository/history.ts";
import type { MutationState } from "#obsidian/annotation-repository/write.ts";
import type { DateTime, Effect, FiberMap, FiberSet } from "effect";

import type { Held } from "@zotlit/plugin-services/core/query-client/service.ts";

import { databaseRowsResolver } from "./bridge.ts";
import { DRAFT_FIELDS, fieldMaps } from "./model.ts";
import type {
  AnnotationConfirmation,
  AnnotationList,
  AnnotationMutation,
  AnnotationRepositoryCoreDeps,
  DatabaseAnnotationSource,
  DraftField,
  DraftFields,
  OutcomeWrite,
} from "./model.ts";
import type { WriteRunFailed } from "./writes.ts";

import { newWriteToken } from "#obsidian/annotation-repository/write.ts";

interface CoreFibers {
  readonly fibers: FiberSet.FiberSet;
  readonly refreshes: FiberMap.FiberMap<string, AnnotationList | null, never>;
  readonly idleSaves: FiberMap.FiberMap<string>;
  readonly burstSaves: FiberMap.FiberMap<string>;
}

class CoreState {
  readonly bridge;
  readonly db;
  readonly queries;
  readonly localApi;
  readonly lastCapability = new Map<string | null, string>();
  readonly outcomes = new Map<string, Map<OutcomeWrite, MutationState>>();
  readonly pendingStates = new WeakMap<AnnotationMutation, MutationState>();
  readonly gone = new Set<string>();
  readonly completeKeys = new Map<string, ReadonlySet<string>>();
  readonly drafts = fieldMaps<DraftField, DraftFields>(DRAFT_FIELDS);
  readonly draftSources = fieldMaps<DraftField, Record<DraftField, string>>(
    DRAFT_FIELDS,
  );
  readonly idleSaves;
  readonly burstSaves;
  readonly operations = new WeakMap<
    AnnotationMutation,
    Effect.Effect<MutationState, WriteRunFailed>
  >();
  readonly histories = new Map<string, AnnotationHistory>();
  readonly steppingAttachments = new Set<string>();
  readonly steppingWrites = new Set<string>();
  readonly writesInFlight = new Map<string, number>();
  commandGeneration = 0;
  readonly refreshes;
  readonly databaseBindings = new Map<
    string,
    {
      source: DatabaseAnnotationSource;
      verifiedGeneration: number;
    }
  >();
  readonly locks = new Map<string, ReadonlyMap<string, AnnotationLock>>();
  readonly lockedLists = new WeakMap<
    AnnotationList,
    { locks: ReadonlyMap<string, AnnotationLock>; list: AnnotationList }
  >();
  readonly publishedLists = new Map<string, AnnotationList>();
  readonly holds = new Map<string, number>();
  readonly lastAsked = new Map<string, DateTime.Utc>();
  readonly publishedStatuses = new Map<
    string,
    Held<AnnotationList>["status"]
  >();
  readonly acknowledgedRevisions = new Map<string, number>();
  readonly confirmedWrites = new Map<string, AnnotationConfirmation[]>();
  databaseGeneration = 0;
  readonly databaseRows;
  readonly fibers;
  readonly writeToken;
  readonly persistedExcerpt;

  constructor(
    {
      bridge,
      db,
      queryClient,
      localApi,
      writeToken = newWriteToken,
      persistedExcerpt,
      publish,
    }: AnnotationRepositoryCoreDeps,
    { fibers, refreshes, idleSaves, burstSaves }: CoreFibers,
  ) {
    this.bridge = bridge;
    this.db = db;
    this.queries = queryClient;
    this.localApi = localApi;
    this.writeToken = writeToken;
    this.persistedExcerpt = persistedExcerpt;
    this.publish = publish;
    this.fibers = fibers;
    this.refreshes = refreshes;
    this.idleSaves = idleSaves;
    this.burstSaves = burstSaves;
    this.databaseRows = databaseRowsResolver(db, fibers);
  }

  readonly publish;
}

export { CoreState };
export type { CoreFibers };
