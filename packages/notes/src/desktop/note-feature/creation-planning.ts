import type { ItemMatchQuery } from "#core/profile-selection/item-matches.ts";
import type { ComposeNoteDeps } from "#obsidian/note-feature/compose.ts";
import type { MatchSelection } from "#obsidian/profile-selection/index.ts";
import type { ResolvedProfile } from "#obsidian/profile/bindings.ts";
import { DateTime, Effect, Schema } from "effect";
import type { TFile } from "obsidian";

import type { Item, ItemFacets } from "@zotlit/db";
import { MetadataCache } from "@zotlit/obsidian-kit/obsidian-metadata-cache.ts";
import type { Vault } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import {
  DEFAULT_PROFILE,
  unknownProfileDiagnostic,
} from "@zotlit/obsidian-kit/profile-stamp.ts";
import type { ProfileSelector } from "@zotlit/obsidian-kit/profile-stamp.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import { toInstant } from "@zotlit/plugin-kernel/worker/effect-clock.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import {
  itemKeyFromFrontmatter,
  noteKeyFromFrontmatter,
  NoteIndex,
} from "@zotlit/plugin-services/obsidian/note-index/service.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";
import type { ZoteroReadsApi } from "@zotlit/zotero-reads/client/service.ts";

import { templateFacets } from "./context.ts";
import { composeWarn } from "./diagnostics.ts";
import type {
  CompanionNoteTarget,
  CreateNoteInternalOptions,
  CreateNoteOptions,
  CreateNoteResult,
  CreationPlan,
  CreationProfileSelection,
  CreationProfileSources,
  CreationSelectionProblem,
  PreparedCreationProfile,
  PreparedProfileSwitch,
  ProfileNotePreview,
  ProfileNotePreviewOptions,
  ProfilePreview,
} from "./types.ts";
import type { CreateNoteError } from "./write-pipeline.ts";

import { prepareManagedFrontmatter } from "#core/note-feature/frontmatter.ts";
import { classifyStream } from "#obsidian/batch/batch-run.ts";
import { applyComposedFrontmatter } from "#obsidian/note-feature/compose.ts";
import { ItemNotFound } from "#obsidian/note-feature/errors.ts";
import {
  renderDocumentFilename,
  resolveNotePath,
  resolveRenderedNotePath,
} from "#obsidian/note-feature/note-path.ts";
import {
  readItem,
  relocationSource,
  resolveProfileDocument,
} from "#obsidian/note-feature/note-reads.ts";
import { selectProfilesByMatch } from "#obsidian/profile-selection/index.ts";
import { relocatedNotePath } from "#obsidian/profile/relocation.ts";
import { Profile } from "#obsidian/profile/service.ts";
import { Template, templateFailure } from "#obsidian/template/service.ts";

const logged = withLogCategory("note-feature");

export type CreationPlanningServices =
  | MetadataCache
  | NoteIndex
  | ItemMatchQuery
  | Profile
  | Template
  | Vault
  | ZoteroReads;

export type CreateAtGate = (
  item: Item,
  options: CreateNoteInternalOptions,
) => Effect.Effect<CreateNoteResult, CreateNoteError>;

export type PlannedCreationProfile = Omit<PreparedCreationProfile, "create"> & {
  readonly create: (
    options?: Pick<CreateNoteOptions, "reportExcerpts" | "outcomes" | "reads">,
  ) => Effect.Effect<CreateNoteResult, CreateNoteError>;
};

export type PlannedCreation = Omit<CreationPlan, "previews"> & {
  readonly previews: readonly PlannedCreationProfile[];
};

export class NotLiteratureNote extends Schema.TaggedError<
  NotLiteratureNote,
  { readonly brand: unique symbol }
>()("NotLiteratureNote", { path: Schema.String }) {
  override get message(): string {
    return "The file is not a ZotLit note";
  }
}

export class ManagedFrontmatterRefused extends Schema.TaggedError<
  ManagedFrontmatterRefused,
  { readonly brand: unique symbol }
>()("ManagedFrontmatterRefused", {
  fields: Schema.Array(Schema.String),
}) {
  override get message(): string {
    return m.managed_frontmatter_eval_recovery({
      field: this.fields.join(", "),
    });
  }
}

export type PreparedProfileNote = Omit<ProfileNotePreview, "create"> & {
  readonly create: Effect.Effect<
    CreateNoteResult,
    | ItemNotFound
    | CreateNoteError
    | Effect.Error<ZoteroReads["Service"]["snapshot"]>
    | Effect.Error<ReturnType<ZoteroReadsApi["ItemsByIndexedKeys"]>>,
    ZoteroReads
  >;
};

const resolveCompanionNote = Effect.fnUntraced(function* (
  indexedKey: string,
  options: { profile?: ProfileSelector } = {},
) {
  const noteIndex = yield* NoteIndex;
  const profiles = yield* Profile;
  yield* noteIndex.whenIndexed;
  if (
    options.profile !== undefined &&
    !(yield* profiles.resolveProfile(options.profile))
  ) {
    yield* Effect.logDebug("Refused unknown Companion Profile").pipe(
      Effect.annotateLogs({ indexedKey, requestedProfile: options.profile }),
      logged,
    );
    return {
      outcome: "refused",
      diagnostic: unknownProfileDiagnostic(options.profile, { indexedKey }),
    } satisfies CompanionNoteTarget;
  }
  const files = yield* noteIndex.getNotesByItemKey(indexedKey);
  const file = files[0];
  if (!file) {
    yield* Effect.logDebug("Companion target needs a Literature Note").pipe(
      Effect.annotateLogs({ indexedKey }),
      logged,
    );
    return { outcome: "create" } satisfies CompanionNoteTarget;
  }
  const resolved = yield* profiles.profileOf(file);
  if (!resolved.ok) {
    yield* Effect.logDebug("Resolved Companion target with unknown stamp").pipe(
      Effect.annotateLogs({
        indexedKey,
        path: file.path,
        stamp: resolved.stamped.stamp,
      }),
      logged,
    );
    return {
      outcome: "existing",
      files: [file, ...files.slice(1)],
      diagnostic: unknownProfileDiagnostic(resolved.stamped.stamp, {
        indexedKey,
        path: file.path,
      }),
    } satisfies CompanionNoteTarget;
  }
  const { selector, label } = resolved.profile;
  const keptProfile =
    options.profile !== undefined && options.profile !== selector
      ? { selector, label }
      : undefined;
  yield* Effect.logDebug("Resolved existing Companion note").pipe(
    Effect.annotateLogs({
      indexedKey,
      path: file.path,
      selector,
      requestedProfile: options.profile,
      kept: keptProfile !== undefined,
    }),
    logged,
  );
  return {
    outcome: "existing",
    files: [file, ...files.slice(1)],
    keptProfile,
  } satisfies CompanionNoteTarget;
});

const planCreations = Effect.fnUntraced(function* (
  indexedKeys: readonly string[],
  options: CreationProfileSources & { create: CreateAtGate },
) {
  yield* (yield* NoteIndex).whenIndexed;
  const profiles = yield* (yield* Profile).profiles;
  const shouldAsk = profiles.length > 0;
  const given = yield* givenCreationProfile(options, shouldAsk);
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const reads = yield* (yield* ZoteroReads).snapshot;
      const itemsByKey = yield* reads.ItemsByIndexedKeys({ indexedKeys });
      const items = indexedKeys.flatMap((key) => itemsByKey.get(key) ?? []);
      const [previews, matches] = yield* Effect.all(
        [
          prepareCreationPreviews(items, { reads, create: options.create }),
          given
            ? Effect.succeed(undefined)
            : selectProfilesByMatch(profiles, items),
        ],
        { concurrency: "unbounded" },
      );
      const matchByItemID = new Map(
        items.map((item, index) => [item.itemID, matches?.[index]]),
      );
      const plans = new Map<string, PlannedCreation>();
      for (const key of indexedKeys) {
        const item = itemsByKey.get(key);
        plans.set(key, {
          item,
          selection:
            given ??
            (yield* matchedCreationProfile(item, {
              result: item && matchByItemID.get(item.itemID),
              shouldAsk,
            })),
          previews: (item && previews.get(item.itemID)) ?? [],
        });
      }
      return plans;
    }),
  );
});

const prepareCreationPreviews = Effect.fnUntraced(function* (
  items: readonly Item[],
  options: { reads: ZoteroReadsApi; create: CreateAtGate },
) {
  const profiles = yield* Effect.forEach(yield* selectableProfiles, (profile) =>
    Effect.map(resolveProfileDocument(profile), (document) => ({
      profile,
      document,
      reserved: new Set<string>(),
    })),
  );
  const itemsByID = new Map(items.map((item) => [item.itemID, item]));
  const facetsByID = new Map<number, ItemFacets>();
  yield* classifyStream(
    {
      itemIDs: items.map(({ itemID }) => itemID),
      read: (ids) =>
        options.reads.ItemFacets({
          items: ids.map((itemID) => ({
            itemID,
            libraryID: itemsByID.get(itemID)!.libraryID,
          })),
        }),
    },
    { onProgress: () => {} },
    (slice) => {
      for (const { itemID, facets } of slice) facetsByID.set(itemID, facets);
    },
  );
  const previewOf = (
    item: Item,
    facets: ItemFacets,
    { profile, document, reserved }: (typeof profiles)[number],
  ) =>
    Effect.gen(function* () {
      const { selector } = profile;
      const unavailable = (message: string, error?: unknown) =>
        Effect.logDebug("Profile creation preview is unavailable").pipe(
          Effect.annotateLogs({
            indexedKey: item.indexedKey,
            selector,
            error: error ?? message,
          }),
          logged,
          Effect.as({ preparedPath: undefined, unavailable: message }),
        );
      const { preparedPath, unavailable: reason } =
        document === null
          ? yield* unavailable(
              m.notice_literature_note_template_missing({
                document: profile.document!,
              }),
            )
          : yield* resolveNotePath(item, {
              ...templateFacets(facets),
              settings: profile.settings,
              document,
              reservedPaths: reserved,
            }).pipe(
              Effect.map((path) => {
                reserved.add(path.path);
                return { preparedPath: path, unavailable: undefined };
              }),
              Effect.catch((error) => unavailable(error.message, error)),
            );
      const preview: PlannedCreationProfile = {
        ...profilePreview(profile, preparedPath?.path),
        unavailable: reason,
        create: (reporting) =>
          options.create(item, {
            ...reporting,
            profile: selector,
            preparedPath,
          }),
      };
      return preview;
    });
  const previews = new Map<number, readonly PlannedCreationProfile[]>();
  for (const item of items) {
    const facets = facetsByID.get(item.itemID);
    if (!facets) continue;
    previews.set(
      item.itemID,
      yield* Effect.forEach(profiles, (entry) =>
        previewOf(item, facets, entry),
      ),
    );
  }
  yield* Effect.logDebug("Prepared creation previews for {count} Items").pipe(
    Effect.annotateLogs({ count: items.length }),
    logged,
  );
  return previews;
});

const selectableProfiles = Effect.gen(function* () {
  const profiles = yield* Profile;
  const selectors: ProfileSelector[] = [
    DEFAULT_PROFILE,
    ...(yield* profiles.profiles).map(({ id }) => id),
  ];
  const resolved = yield* Effect.forEach(selectors, (selector) =>
    profiles.resolveProfile(selector),
  );
  return resolved.filter(
    (profile): profile is ResolvedProfile => profile !== undefined,
  );
});

function profilePreview(
  profile: ResolvedProfile,
  path: string | undefined,
): ProfilePreview {
  return {
    selector: profile.selector,
    label: profile.label,
    folder: profile.bindings["note.literature-folder"],
    citationStyle: profile.bindings["citation.references-style"],
    document: profile.document,
    path,
  };
}

const resolveCreationProfile = Effect.fnUntraced(function* (
  sources: CreationProfileSources = {},
) {
  const shouldAsk = (yield* (yield* Profile).profiles).length > 0;
  return (
    (yield* givenCreationProfile(sources, shouldAsk)) ??
    (yield* matchedCreationProfile(undefined, { shouldAsk }))
  );
});

const stoppedCreationProfile = (
  problem: CreationSelectionProblem,
  item: Item | undefined,
) =>
  Effect.logDebug("Creation Profile selection stopped ({kind})").pipe(
    Effect.annotateLogs({ kind: problem.kind, indexedKey: item?.indexedKey }),
    logged,
    Effect.as<CreationProfileSelection>({
      selector: DEFAULT_PROFILE,
      source: "bound",
      shouldAsk: true,
      problem,
    }),
  );

const givenCreationProfile = Effect.fnUntraced(function* (
  sources: CreationProfileSources,
  shouldAsk: boolean,
) {
  const profiles = yield* Profile;
  for (const source of ["asked", "headless"] as const) {
    const selector = sources[source];
    if (selector === undefined) continue;
    if (!(yield* profiles.resolveProfile(selector)))
      return yield* stoppedCreationProfile(
        { kind: "invalid-selector", source, selector },
        undefined,
      );
    yield* Effect.logDebug(
      "Resolved creation Profile {selector} from {source}",
    ).pipe(Effect.annotateLogs({ selector, source }), logged);
    const selection: CreationProfileSelection = { selector, source, shouldAsk };
    return selection;
  }
  return undefined;
});

function matchedCreationProfile(
  item: Item | undefined,
  { result, shouldAsk }: { result?: MatchSelection; shouldAsk: boolean },
): Effect.Effect<CreationProfileSelection> {
  if (result?.outcome === "overlap")
    return stoppedCreationProfile(
      { kind: "overlap", candidates: result.candidates },
      item,
    );
  if (result?.outcome === "failed")
    return Effect.succeed({
      selector: DEFAULT_PROFILE,
      source: "bound",
      shouldAsk: true,
    });
  if (result?.outcome === "matched")
    return Effect.succeed({
      selector: result.profile.id,
      source: "match",
      shouldAsk: false,
      reason: m.profile_match_selected(result.reason),
    });
  return Effect.succeed({
    selector: DEFAULT_PROFILE,
    source: "bound",
    shouldAsk,
  });
}

const prepareProfileNote = Effect.fnUntraced(function* (
  options: ProfileNotePreviewOptions,
  {
    create,
    events,
  }: { create: CreateAtGate } & Pick<ComposeNoteDeps, "events">,
) {
  const { profile, document, note, filename } = options;
  const preparedPath = yield* resolveRenderedNotePath(
    profile.bindings["note.literature-folder"],
    yield* renderDocumentFilename(document, filename),
  );
  const prepared = prepareManagedFrontmatter(
    document.frontmatter,
    note,
    toInstant(yield* DateTime.now),
  );
  if ("failures" in prepared)
    return yield* new ManagedFrontmatterRefused({
      fields: prepared.failures.map(({ key }) => key),
    });
  const frontmatterFields =
    prepared.prepared.kind === "legacy"
      ? yield* (yield* Template).frontmatterFields
      : [];
  const properties: Record<string, unknown> = {};
  applyComposedFrontmatter(
    { template: { frontmatterFields }, warn: yield* composeWarn, events },
    properties,
    {
      context: note,
      itemKey: note.indexedKey,
      profile,
      prepared: prepared.prepared,
    },
  );
  const body = yield* Effect.try({
    try: () => document.renderForCreate(note),
    catch: templateFailure,
  });
  const preview: PreparedProfileNote = {
    path: preparedPath.path,
    body,
    properties,
    create: Effect.scoped(
      Effect.gen(function* () {
        const reads = yield* (yield* ZoteroReads).snapshot;
        const item = yield* readItem(reads, note.indexedKey);
        if (!item)
          return yield* new ItemNotFound({
            indexedKey: note.indexedKey,
            message: m.notice_protocol_item_not_found(),
          });
        return yield* create(item, {
          profile: profile.selector,
          preparedPath,
          reads,
        });
      }),
    ),
  };
  return preview;
});

const getImportedNotesForItem = Effect.fnUntraced(function* (
  indexedKey: string,
) {
  const noteIndex = yield* NoteIndex;
  yield* noteIndex.whenIndexed;
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const reads = yield* (yield* ZoteroReads).snapshot;
      const item = yield* readItem(reads, indexedKey);
      if (!item)
        return yield* new ItemNotFound({
          indexedKey,
          message: `Zotero item not found: ${indexedKey}`,
        });
      const { childNotes } = yield* reads.ItemFamily({ itemID: item.itemID });
      const notes = yield* Effect.forEach(childNotes, (note) =>
        noteIndex.getImportedNoteByNoteKey(note.indexedKey),
      );
      return notes.flat();
    }),
  );
});

const prepareProfileSwitch = Effect.fnUntraced(function* (file: TFile) {
  const current = yield* (yield* Profile).profileOf(file);
  const cache = yield* (yield* MetadataCache).fileCache(file);
  const imported = noteKeyFromFrontmatter(cache) !== null;
  const indexedKey = itemKeyFromFrontmatter(cache);
  if (!imported && !indexedKey)
    return yield* new NotLiteratureNote({ path: file.path });
  const source = relocationSource(current);
  const profiles = (yield* selectableProfiles).map((profile) => ({
    ...profilePreview(
      profile,
      relocatedNotePath(file, { from: source, to: profile, imported }),
    ),
    folder:
      profile.bindings[
        imported ? "note.import-folder" : "note.literature-folder"
      ],
  }));
  const importedNotes: TFile[] | null = imported
    ? []
    : yield* getImportedNotesForItem(indexedKey!).pipe(
        Effect.catch((error) =>
          Effect.logDebug(
            "Could not check Imported Notes while preparing a Profile switch",
          ).pipe(
            Effect.annotateLogs({ path: file.path, indexedKey, error }),
            logged,
            Effect.as(null),
          ),
        ),
      );
  yield* Effect.logDebug("Prepared note Profile switch").pipe(
    Effect.annotateLogs({
      path: file.path,
      imported,
      profiles: profiles.length,
      importedNotes: importedNotes?.length ?? null,
    }),
    logged,
  );
  const plan: PreparedProfileSwitch = {
    imported,
    current: current.ok
      ? { selector: current.profile.selector, label: current.profile.label }
      : { selector: undefined, label: current.stamped.stamp },
    profiles,
    importedNotes,
  };
  return plan;
});

export {
  getImportedNotesForItem,
  planCreations,
  prepareProfileNote,
  prepareProfileSwitch,
  resolveCompanionNote,
  resolveCreationProfile,
};
