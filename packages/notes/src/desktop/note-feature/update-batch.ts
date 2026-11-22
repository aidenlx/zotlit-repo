import type { BatchTarget } from "#desktop/batch/batch-scope.ts";
import type {
  BatchProfileChoice,
  BatchProfileChoiceScope,
  FlatTask,
} from "#desktop/batch/modal/index.ts";
import type { NoteImportView } from "#desktop/note-import/view.ts";
import type { ProfileDialogServices } from "#desktop/profile/dialogs.ts";
import type { BatchProfileCount } from "#obsidian/batch/batch-profile-summary.ts";
import type {
  BatchClassifyControls,
  BatchRunControls,
  RunOutcome,
} from "#obsidian/batch/batch-run.ts";
import type { ResolvedProfile } from "#obsidian/profile/bindings.ts";
import type { LiteratureNoteProfile } from "#obsidian/profile/service.ts";
import { Effect, Option, Predicate, Schema } from "effect";
import type { TFile } from "obsidian";

import type { ExcerptSummary } from "@zotlit/annotations/desktop/excerpt-image/prepare.ts";
import { ExcerptOutcomeScope } from "@zotlit/annotations/obsidian/excerpt-image/outcome-scope.ts";
import type { ItemRef } from "@zotlit/db";
import { Notifier, withProgress } from "@zotlit/obsidian-kit/notifier.ts";
import { MetadataCache } from "@zotlit/obsidian-kit/obsidian-metadata-cache.ts";
import { Workspace } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import type { ProfileSelector } from "@zotlit/obsidian-kit/profile-stamp.ts";
import {
  DEFAULT_PROFILE,
  unknownProfileDiagnostic,
} from "@zotlit/obsidian-kit/profile-stamp.ts";
import type { EffectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import type { Settings } from "@zotlit/plugin-services/core/settings/schema.ts";
import type { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import type { LibraryScope } from "@zotlit/plugin-services/obsidian/library-scope/service.ts";
import {
  itemKeyFromFrontmatter,
  NoteIndex,
} from "@zotlit/plugin-services/obsidian/note-index/service.ts";
import { databaseReady as sharedDatabaseReady } from "@zotlit/plugin-services/obsidian/protocol/link.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import { readDisplayRef } from "@zotlit/zotero-reads/client/display-ref.ts";
import type { ItemDisplayRef } from "@zotlit/zotero-reads/client/display-ref.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";
import type { ZoteroReadsApi } from "@zotlit/zotero-reads/client/service.ts";

import type {
  PlannedCreation,
  PlannedCreationProfile,
} from "./creation-planning.ts";
import type {
  CreateNoteDiagnostic,
  CreateNoteResult,
  NoteOperationDiagnostic,
  UpdateScope,
  CreationProfileSelection,
} from "./operations.ts";
import {
  describeSelectionProblem,
  describeSelectionSource,
} from "./selection-copy.ts";
import { collectExcerptReports, NoteFeature } from "./service.ts";
import {
  createNoteNotice,
  duplicateLiteratureNoteWarning,
  noteOperationDiagnosticNotice,
  updateWithNotice,
} from "./update-single.ts";
import type { BatchUpdateNotices } from "./update-single.ts";

import { isInertTemplateError } from "#core/template/errors.ts";
import {
  batchGroupKey,
  batchGroups,
  batchLibraries,
  planBatchScope,
  withUnavailableLibraries,
} from "#desktop/batch/batch-scope.ts";
import { FlatManifest } from "#desktop/batch/modal/index.ts";
import { batchProfileSummary } from "#obsidian/batch/batch-profile-summary.ts";
import {
  classifyStream,
  executeBatchRun,
  modalRunner,
} from "#obsidian/batch/batch-run.ts";
import { Profile } from "#obsidian/profile/service.ts";

const logged = withLogCategory("batch-update");

function profileLabel(profile: ResolvedProfile): string {
  return profile.label ?? m.settings_profile_default_name();
}

export type BatchUpdateServices =
  | LibraryScope
  | MetadataCache
  | NoteFeature
  | NoteIndex
  | Notifier
  | PluginSettings
  | Profile
  | ProfileDialogServices
  | Workspace
  | ZoteroPref
  | ZoteroReads;

export interface BatchUpdatePorts {
  readonly notices: BatchUpdateNotices;
  readonly bridge: Pick<EffectBridge, "runPromiseExit">;
  readonly view: Pick<NoteImportView, "openBatchModal" | "chooseProfile">;
}

type CreationOrigin = "selected" | "unresolved" | "affected";

type CreateAction = {
  kind: "create";
  selection?: CreationProfileSelection;
  origin?: CreationOrigin;
  prepared?: PlannedCreationProfile;
};

type BatchAction = {
  itemID: number;
  indexedKey: string;
  label: string;
  libraryID: number;
  profile?: ResolvedProfile;
  unknownStamp?: string;
} & ({ kind: "update"; file: TFile } | CreateAction);

interface NotFoundEntry {
  itemID: number;
  label: string;
}

interface RunContext {
  reportExcerpts: (summary: ExcerptSummary) => void;
  reads: ZoteroReadsApi;
  settings: Readonly<Settings>;
  outcomes: ExcerptOutcomeScope;
  scope: UpdateScope;
  profile?: ProfileSelector;
  profiles: Profile["Service"];
  noteFeature: NoteFeature["Service"];
}

export type BatchUpdateResult =
  | { outcome: "db-unavailable" }
  | { outcome: "empty-selection" }
  | { outcome: "no-library-in-scope" }
  | { outcome: "unavailable-target" }
  | { outcome: "collection-not-found" }
  | { outcome: "not-found" }
  | { outcome: "single-update" }
  | { outcome: "metadata-no-note" }
  | { outcome: "batch-modal" };

export interface BatchUpdateOptions {
  scope?: UpdateScope;
  create?: boolean;
  confirmOne?: boolean;
  unavailableLibraries?: number;
  profile?: ProfileSelector;
}

const updateResult = (value: BatchUpdateResult): BatchUpdateResult => value;

const databaseReady = Effect.flatMap(ZoteroReads, (zoteroReads) =>
  sharedDatabaseReady(zoteroReads, "batch-update"),
);

const literatureNoteWithWarning = Effect.fnUntraced(function* (
  notes: readonly TFile[],
) {
  const warning = duplicateLiteratureNoteWarning(notes);
  if (warning) yield* (yield* Notifier).show(warning);
  const first: TFile | undefined = notes[0];
  return first;
});

export const batchUpdateItems = Effect.fn("batchUpdateItems")(function* (
  ports: BatchUpdatePorts,
  itemIDs: readonly number[],
  opts: BatchUpdateOptions = {},
) {
  const { scope = "full", unavailableLibraries = 0, profile } = opts;
  const create = scope === "full" && (opts.create ?? true);
  if (!(yield* databaseReady)) {
    yield* Effect.logWarning("Batch update: database not ready").pipe(
      Effect.annotateLogs({ count: itemIDs.length }),
      logged,
    );
    return updateResult({ outcome: "db-unavailable" });
  }

  const [firstID, ...restIDs] = itemIDs;
  if (firstID === undefined) {
    return updateResult({ outcome: "empty-selection" });
  }

  yield* (yield* NoteIndex).whenIndexed;
  const profiles = yield* Profile;
  if (profile !== undefined && !(yield* profiles.resolveProfile(profile))) {
    return yield* new BatchUpdateRefusedError({
      diagnostic: unknownProfileDiagnostic(profile),
    });
  }
  const profilesEnabled = (yield* profiles.profiles).length > 0;
  if (restIDs.length === 0 && !profilesEnabled && !opts.confirmOne) {
    const ref = yield* displayRef(firstID);
    if (!ref) {
      return updateResult({ outcome: "not-found" });
    }
    return yield* updateNote(ports, ref, { scope, create, profile });
  }

  yield* openBatchUpdateModal(ports, itemIDs, {
    scope,
    create,
    unavailableLibraries,
    profile,
    profilesEnabled,
  });
  return updateResult({ outcome: "batch-modal" });
});

export function batchUpdateResultNotice(
  result: BatchUpdateResult,
): string | undefined {
  return result.outcome === "metadata-no-note"
    ? m.notice_update_metadata_no_note()
    : undefined;
}

export const runBatchUpdate = Effect.fn("runBatchUpdate")(function* (
  ports: BatchUpdatePorts,
  itemIDs: readonly number[],
  opts: BatchUpdateOptions = {},
) {
  const result = yield* batchUpdateItems(ports, itemIDs, opts);
  const notice = batchUpdateResultNotice(result);
  if (notice) yield* (yield* Notifier).show(notice);
  return result;
});

const updateNote = Effect.fnUntraced(function* (
  ports: BatchUpdatePorts,
  ref: ItemRef,
  {
    scope,
    create,
    profile,
  }: { scope: UpdateScope; create: boolean; profile?: ProfileSelector },
) {
  const file = yield* literatureNoteWithWarning(
    yield* (yield* NoteIndex).getNotesByItemKey(ref.indexedKey),
  );

  if (!file) {
    if (!create) return updateResult({ outcome: "metadata-no-note" });
    yield* createAndOpen(ports, ref, profile);
    return updateResult({ outcome: "single-update" });
  }

  const itemKey = itemKeyFromFrontmatter(
    yield* (yield* MetadataCache).fileCache(file),
  );
  if (!itemKey) return updateResult({ outcome: "single-update" });

  yield* updateWithNotice(
    file,
    { indexedKey: itemKey, scope, profile },
    ports.notices.updateToast(scope),
  );
  return updateResult({ outcome: "single-update" });
});

const createAndOpen = Effect.fnUntraced(function* (
  ports: BatchUpdatePorts,
  ref: ItemRef,
  profile: ProfileSelector | undefined,
) {
  const { reads } = yield* ZoteroReads;
  const items = yield* reads.ItemsByIndexedKeys({
    indexedKeys: [ref.indexedKey],
  });
  const item = items.get(ref.indexedKey);
  if (!item) return;

  const created = yield* withProgress(
    (yield* NoteFeature).createNote(item, { profile }),
    ports.notices.createToast,
  ).pipe(Effect.option);
  if (Option.isNone(created) || created.value.outcome !== "created") return;
  yield* (yield* Workspace).openLinkText(created.value.file.path, "", {
    newLeaf: false,
    state: { active: true },
  });
});

const openBatchUpdateModal = Effect.fnUntraced(function* (
  ports: BatchUpdatePorts,
  itemIDs: readonly number[],
  {
    scope,
    create,
    unavailableLibraries,
    profile,
    profilesEnabled,
  }: {
    scope: UpdateScope;
    create: boolean;
    unavailableLibraries: number;
    profile: ProfileSelector | undefined;
    profilesEnabled: boolean;
  },
) {
  const { run, settle } = yield* modalRunner<BatchUpdateServices>(ports.bridge);
  const profiles = yield* Profile;
  let actions: BatchAction[] = [];
  const noteFeature = yield* NoteFeature;
  let plans: ReadonlyMap<string, PlannedCreation> = new Map();
  let keptCount = 0;
  let notFoundCount = 0;
  const profileCounts = new Map<ProfileSelector, BatchProfileCount>();
  const creations = () =>
    actions.filter(
      (action): action is BatchAction & CreateAction =>
        action.kind === "create",
    );
  const assign = Effect.fnUntraced(function* (
    action: BatchAction & CreateAction,
    selection: CreationProfileSelection,
  ) {
    action.selection = selection;
    action.profile = selection.problem
      ? undefined
      : yield* profiles.resolveProfile(selection.selector);
    action.prepared =
      action.profile &&
      plans
        .get(action.indexedKey)
        ?.previews.find((entry) => entry.selector === selection.selector);
  });
  const ensurePlans = Effect.fnUntraced(function* (
    indexedKey: string,
    selectors: readonly ProfileSelector[],
  ) {
    const prepared = plans.get(indexedKey)?.previews ?? [];
    if (
      selectors.every((id) => prepared.some((entry) => entry.selector === id))
    )
      return;
    plans = yield* noteFeature.planCreations(
      creations().map((action) => action.indexedKey),
      { headless: profile },
    );
  });
  const choose = Effect.fnUntraced(function* (
    scope: BatchProfileChoiceScope,
    rows: () => (BatchAction & CreateAction)[],
  ) {
    const first = rows()[0];
    if (!first) return;
    yield* ensurePlans(
      first.indexedKey,
      (yield* profiles.profiles).map(({ id }) => id),
    );
    const chosen = yield* ports.view.chooseProfile({
      indexedKey: first.indexedKey,
      selection: fallbackSelection(rows()),
      problem:
        [
          ...new Set(
            rows().flatMap(({ selection }) =>
              selection?.problem
                ? [describeSelectionProblem(selection.problem)]
                : [],
            ),
          ),
        ].join(" ") || undefined,
      previews: plans.get(first.indexedKey)?.previews ?? [],
    });
    if (chosen === undefined) return;
    yield* ensurePlans(first.indexedKey, [chosen]);
    for (const row of rows())
      yield* assign(row, {
        selector: chosen,
        source: "asked",
        shouldAsk: true,
      });
    yield* Effect.logDebug("Changed batch creation Profile").pipe(
      Effect.annotateLogs({ scope, selector: chosen, items: rows().length }),
      logged,
    );
  });
  const choiceFor = (
    scope: BatchProfileChoiceScope,
    rows: () => (BatchAction & CreateAction)[],
  ): BatchProfileChoice => ({
    scope,
    get count() {
      return rows().length;
    },
    get label() {
      const shared = sharedProfile(rows());
      return shared && profileLabel(shared);
    },
    get source() {
      return rows()[0]?.selection?.source ?? "bound";
    },
    choose: () => settle(choose(scope, rows)),
  });
  const classify = Effect.fnUntraced(function* (
    controls: BatchClassifyControls,
  ) {
    const classified = yield* classifyActions(itemIDs, {
      controls,
      createMissing: create,
      profile,
      profilesEnabled,
    });
    actions = classified.actions;
    keptCount = classified.kept.length;
    notFoundCount = classified.notFound.length;
    let profileChoices: BatchProfileChoice[] | undefined;
    if (profilesEnabled && creations().length > 0) {
      plans = yield* noteFeature.planCreations(
        creations().map((action) => action.indexedKey),
        { headless: profile },
      );
      for (const action of creations()) {
        const { selection } = plans.get(action.indexedKey)!;
        action.origin =
          selection.problem && selection.problem.kind !== "overlap"
            ? "affected"
            : selection.source === "bound"
              ? "unresolved"
              : "selected";
        yield* assign(action, selection);
      }
      const rowsOf = (origin: CreationOrigin) => () =>
        creations().filter((action) => action.origin === origin);
      profileChoices = [
        ...(rowsOf("unresolved")().length > 0
          ? [choiceFor("unresolved", rowsOf("unresolved"))]
          : []),
        ...(rowsOf("affected")().length > 0
          ? [choiceFor("affected", rowsOf("affected"))]
          : []),
        choiceFor("all-new", creations),
      ];
    }
    return new FlatManifest({
      tasks: actions.map((action) => batchTask(action, profilesEnabled)),
      notFound: classified.notFound,
      profileChoices,
      groups: batchGroups(classified.libraries, [
        { kind: "update", header: m.batch_update_group_update },
        {
          kind: "create",
          header: m.batch_update_group_create,
        },
      ]),
      upToDate: classified.skipped,
      upToDateHeader: m.batch_update_group_no_note,
      kept: classified.kept,
      keptHeader: m.batch_profile_kept_header,
      notFoundHeader: m.batch_update_group_not_found,
      abortedHeader: m.batch_update_group_aborted,
    });
  });
  yield* Effect.sync(() =>
    ports.view.openBatchModal({
      text: {
        title: m.batch_update_title(),
        loadingLabel: m.batch_update_loading_label(),
        loadFailed: m.batch_update_load_failed(),
        runFailed: ports.notices.runFailed,
        progressLabel: m.batch_update_progress_label(),
        confirmIntro: (counts) =>
          withUnavailableLibraries(
            create ? updateOrCreateIntro(counts) : updateExistingIntro(counts),
            unavailableLibraries,
          ),
        confirmButton: m.batch_update_confirm_button(),
        runSummary: (result, state) =>
          profilesEnabled
            ? batchProfileSummary(result, {
                ...state,
                profiles: [...profileCounts.values()],
                kept: keptCount,
                notFound: notFoundCount,
              })
            : state.aborted
              ? m.batch_update_aborted(result)
              : state.cancelled
                ? m.batch_update_summary_cancelled(result)
                : m.batch_update_summary(result),
      },
      total: itemIDs.length,
      onClassify: (controls) => run(classify(controls), controls.signal),
      onRun: (controls) =>
        run(
          executeBatchActions(
            ports,
            {
              actions,
              scope,
              profile,
              profileCounts: profilesEnabled ? profileCounts : undefined,
            },
            controls,
          ),
        ),
    }),
  );
});

function sharedProfile(
  rows: readonly (BatchAction & CreateAction)[],
): ResolvedProfile | undefined {
  const [first, ...rest] = rows;
  if (!first?.profile) return undefined;
  return rest.every((row) => row.profile?.selector === first.profile!.selector)
    ? first.profile
    : undefined;
}

function fallbackSelection(
  rows: readonly CreateAction[],
): CreationProfileSelection {
  const candidates = new Map<ProfileSelector, LiteratureNoteProfile>();
  for (const { selection } of rows)
    if (selection?.problem?.kind === "overlap")
      for (const candidate of selection.problem.candidates)
        candidates.set(candidate.id, candidate);
  if (candidates.size)
    return {
      selector: DEFAULT_PROFILE,
      source: "bound",
      shouldAsk: true,
      problem: { kind: "overlap", candidates: [...candidates.values()] },
    };
  return (
    rows[0]?.selection ?? {
      selector: DEFAULT_PROFILE,
      source: "bound",
      shouldAsk: true,
    }
  );
}

function batchTask(action: BatchAction, profilesEnabled: boolean): FlatTask {
  const task = {
    id: action.itemID,
    label: action.label,
    kind: batchGroupKey(action.libraryID, action.kind),
  };
  if (!profilesEnabled) return task;
  if (action.kind !== "create")
    return {
      ...task,
      profile: action.profile
        ? profileLabel(action.profile)
        : action.unknownStamp,
    };
  return {
    ...task,
    get profile() {
      return action.profile && profileLabel(action.profile);
    },
    get path() {
      return action.prepared?.path;
    },
    get reason() {
      const { selection, prepared } = action;
      return (
        [selection && creationReason(selection), prepared?.unavailable]
          .filter(Boolean)
          .join(" ") || undefined
      );
    },
  };
}

function creationReason(selection: CreationProfileSelection): string {
  if (selection.problem) return describeSelectionProblem(selection.problem);
  if (selection.source === "match") return selection.reason;
  return (
    describeSelectionSource(selection.source) ?? m.profile_match_unmatched()
  );
}

const displayRef = Effect.fnUntraced(function* (itemID: number) {
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const reads = yield* (yield* ZoteroReads).snapshot;
      return yield* readDisplayRef(reads, itemID);
    }),
  );
});

const classifyActions = Effect.fnUntraced(function* (
  itemIDs: readonly number[],
  {
    controls,
    createMissing,
    profile,
    profilesEnabled,
  }: {
    controls: Pick<BatchClassifyControls, "onProgress">;
    createMissing: boolean;
    profile?: ProfileSelector;
    profilesEnabled: boolean;
  },
) {
  const noteIndex = yield* NoteIndex;
  const profiles = yield* Profile;
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const reads = yield* (yield* ZoteroReads).snapshot;
      const actions: BatchAction[] = [];
      const skipped: NotFoundEntry[] = [];
      const notFound: NotFoundEntry[] = [];
      const kept: { label: string; profile: string; reason: string }[] = [];
      const refs: { itemID: number; ref: ItemDisplayRef }[] = [];
      yield* classifyStream(
        { itemIDs, read: (ids) => reads.DisplayRefs({ itemIDs: ids }) },
        controls,
        (slice) => {
          for (const { itemID, ref } of slice) {
            if (ref) refs.push({ itemID, ref });
            else
              notFound.push({
                itemID,
                label: m.batch_update_unknown_item({ id: itemID }),
              });
          }
        },
      );
      for (const { itemID, ref } of refs) {
        const file = yield* literatureNoteWithWarning(
          yield* noteIndex.getNotesByItemKey(ref.indexedKey),
        );
        const label = itemLabel(ref.title, itemID);
        const row = {
          itemID,
          indexedKey: ref.indexedKey,
          label,
          libraryID: ref.libraryID,
        };
        if (file) {
          const stamped = yield* profiles.profileOf(file);
          if (
            profilesEnabled &&
            stamped.ok &&
            profile !== undefined &&
            stamped.profile.selector !== profile
          ) {
            const requested = (yield* profiles.resolveProfile(profile))!;
            kept.push({
              label,
              profile: profileLabel(stamped.profile),
              reason: m.batch_profile_kept_reason({
                label: profileLabel(stamped.profile),
                requested: profileLabel(requested),
              }),
            });
          } else {
            actions.push({
              ...row,
              kind: "update",
              file,
              ...(stamped.ok
                ? { profile: stamped.profile }
                : { unknownStamp: stamped.stamped.stamp }),
            });
          }
        } else if (!createMissing) {
          skipped.push({ itemID, label });
        } else {
          actions.push({ ...row, kind: "create" });
        }
      }

      const libraries = batchLibraries(
        yield* reads.Libraries({}),
        new Set(actions.map((action) => action.libraryID)),
      );

      const { update = [], create = [] } = Object.groupBy(
        actions,
        (t) => t.kind,
      );
      yield* Effect.logInfo("Batch update classified").pipe(
        Effect.annotateLogs({
          total: itemIDs.length,
          update: update.length,
          create: create.length,
          skipped: skipped.length,
          kept: kept.length,
          notFound: notFound.length,
          libraries: libraries.length,
        }),
        logged,
      );
      return { actions, skipped, notFound, libraries, kept };
    }),
  );
});

const executeBatchActions = Effect.fnUntraced(function* (
  ports: BatchUpdatePorts,
  plan: {
    actions: readonly BatchAction[];
    scope: UpdateScope;
    profile?: ProfileSelector;
    profileCounts?: Map<ProfileSelector, BatchProfileCount>;
  },
  controls: BatchRunControls,
) {
  const { actions, scope, profile } = plan;
  const zoteroReads = yield* ZoteroReads;
  const profiles = yield* Profile;
  const noteFeature = yield* NoteFeature;
  const failures: { itemID: number; error: unknown }[] = [];
  const result = yield* Effect.scoped(
    Effect.gen(function* () {
      const excerptReports = yield* collectExcerptReports;
      const settings = yield* (yield* PluginSettings).current;
      const outcomes = yield* Effect.acquireDisposable(
        Effect.sync(() => new ExcerptOutcomeScope()),
      );
      const reads = yield* zoteroReads.snapshot;
      const run: RunContext = {
        reportExcerpts: excerptReports.add,
        reads,
        settings,
        scope,
        profile,
        outcomes,
        profiles,
        noteFeature,
      };
      return yield* executeBatchRun({
        tasks: actions.map((a) => ({ ...a, id: a.itemID })),
        controls,
        concurrency: 32,
        run: (task) =>
          Effect.tap(runAction(ports, task, run), (outcome) =>
            Effect.sync(() => {
              if (
                plan.profileCounts &&
                task.profile &&
                (outcome === "created" || outcome === "updated")
              ) {
                const count = plan.profileCounts.get(task.profile.selector) ?? {
                  label: profileLabel(task.profile),
                  created: 0,
                  updated: 0,
                };
                count[outcome]++;
                plan.profileCounts.set(task.profile.selector, count);
              }
            }),
          ),
        onTaskFailed: (task, error) => {
          failures.push({ itemID: task.itemID, error });
        },
        haltOn: isInertTemplateError,
      });
    }),
  );
  for (const failure of failures)
    yield* Effect.logWarning("Batch update item failed").pipe(
      Effect.annotateLogs(failure),
      logged,
    );

  yield* Effect.logInfo("Batch update finished").pipe(
    Effect.annotateLogs({ ...result, total: actions.length }),
    logged,
  );
  return result;
});

const runAction = Effect.fnUntraced(function* (
  ports: BatchUpdatePorts,
  action: BatchAction,
  run: RunContext,
) {
  const items = yield* run.reads.ItemsByIndexedKeys({
    indexedKeys: [action.indexedKey],
  });
  const item = items.get(action.indexedKey);
  if (!item)
    return yield* new BatchRowRefused({
      message: m.batch_update_unknown_item({ id: action.itemID }),
    });

  if (action.kind === "update") {
    const updated = yield* run.noteFeature.writeNoteUpdate(action.file, {
      reportExcerpts: run.reportExcerpts,
      reads: run.reads,
      item,
      settings: run.settings,
      scope: run.scope,
      outcomes: run.outcomes,
    });
    if (updated.diagnostic) {
      return yield* new BatchUpdateRefusedError({
        diagnostic: updated.diagnostic,
      });
    }
    const outcome: RunOutcome = "updated";
    return outcome;
  }
  if (action.selection?.problem)
    return yield* new BatchRowRefused({
      message: describeSelectionProblem(action.selection.problem),
    });
  const prepared = action.prepared;
  if (prepared) {
    if (!(yield* run.profiles.resolveProfile(prepared.selector)))
      return yield* new BatchUpdateRefusedError({
        diagnostic: unknownProfileDiagnostic(prepared.selector),
      });
    return yield* batchCreateOutcome(
      yield* prepared.create({
        reportExcerpts: run.reportExcerpts,
        outcomes: run.outcomes,
        reads: run.reads,
      }),
    );
  }
  return yield* batchCreateOutcome(
    yield* run.noteFeature.createNote(item, {
      reportExcerpts: run.reportExcerpts,
      profile: action.selection?.selector ?? run.profile,
      outcomes: run.outcomes,
      reads: run.reads,
    }),
  );
});

class BatchRowRefused extends Schema.TaggedError<
  BatchRowRefused,
  { readonly brand: unique symbol }
>()("BatchRowRefused", { message: Schema.String }) {}

export class BatchUpdateRefusedError extends Schema.TaggedError<
  BatchUpdateRefusedError,
  { readonly brand: unique symbol }
>()("BatchUpdateRefusedError", {
  diagnostic: Schema.declare(
    (input: unknown): input is NoteOperationDiagnostic =>
      Predicate.isObject(input),
  ),
}) {
  override get message(): string {
    return noteOperationDiagnosticNotice(this.diagnostic);
  }
}

export class BatchCreateRefusedError extends Schema.TaggedError<
  BatchCreateRefusedError,
  { readonly brand: unique symbol }
>()("BatchCreateRefusedError", {
  diagnostic: Schema.declare((input: unknown): input is CreateNoteDiagnostic =>
    Predicate.isObject(input),
  ),
}) {
  override get message(): string {
    return createNoteNotice({
      outcome: "refused",
      diagnostic: this.diagnostic,
    });
  }
}

export function batchCreateOutcome(
  result: CreateNoteResult,
): Effect.Effect<"created", BatchCreateRefusedError> {
  return result.outcome === "refused"
    ? Effect.fail(
        new BatchCreateRefusedError({ diagnostic: result.diagnostic }),
      )
    : Effect.succeed("created");
}

export const runBatchUpdateAll = Effect.fn("runBatchUpdateAll")(function* (
  ports: BatchUpdatePorts,
  options: BatchTarget & Pick<BatchUpdateOptions, "create"> = {},
) {
  if (!(yield* databaseReady)) {
    yield* Effect.logWarning("Batch update all: database not ready").pipe(
      logged,
    );
    return updateResult({ outcome: "db-unavailable" });
  }

  const plan = yield* planBatchScope("literature-items", options);
  if (plan.outcome !== "resolved")
    return updateResult({ outcome: plan.outcome });

  if (plan.itemIDs.length === 0) {
    return updateResult({ outcome: "empty-selection" });
  }
  return yield* runBatchUpdate(ports, plan.itemIDs, {
    create: options.create,
    confirmOne: true,
    unavailableLibraries: plan.unavailableLibraries,
  });
});

function updateOrCreateIntro(counts: {
  actionable: number;
  notFound: number;
}): string {
  return counts.actionable === 0
    ? m.batch_update_confirm_none({ count: counts.notFound })
    : m.batch_update_confirm_intro({ count: counts.actionable });
}

function updateExistingIntro({ actionable }: { actionable: number }): string {
  return actionable === 0
    ? m.batch_update_existing_confirm_none()
    : m.batch_update_existing_confirm_intro({ count: actionable });
}

function itemLabel(title: string | null, itemID: number): string {
  return title?.trim() || m.batch_update_untitled({ id: itemID });
}
