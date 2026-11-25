import type {
  ComposeFrontmatterInput,
  ComposeNoteDeps,
} from "#obsidian/note-feature/compose.ts";
import type { ResolvedProfile } from "#obsidian/profile/bindings.ts";
import type { ResolvedLiteratureNoteTemplate } from "#obsidian/template/service.ts";
import { Cause, DateTime, Effect, Fiber, Option, Result, Stream } from "effect";
import { getFrontMatterInfo } from "obsidian";
import type { TFile } from "obsidian";

import {
  nonEmptySummary,
  ExcerptPreparation,
} from "@zotlit/annotations/desktop/excerpt-image/prepare.ts";
import type {
  ExcerptSummary,
  PreparedExcerpts,
} from "@zotlit/annotations/desktop/excerpt-image/prepare.ts";
import { outcomeScope } from "@zotlit/annotations/obsidian/excerpt-image/outcome-scope.ts";
import type { ExcerptOutcomeScope } from "@zotlit/annotations/obsidian/excerpt-image/outcome-scope.ts";
import { buildNoteContextFromSource } from "@zotlit/db";
import type { Item, NoteSource, NoteTemplateContext } from "@zotlit/db";
import { processLiveText } from "@zotlit/obsidian-kit/effect-live-text.ts";
import {
  parseFrontMatter,
  spliceFrontMatter,
} from "@zotlit/obsidian-kit/live-text.ts";
import {
  FileManager,
  markdownLinker,
} from "@zotlit/obsidian-kit/obsidian-file-manager.ts";
import { MetadataCache } from "@zotlit/obsidian-kit/obsidian-metadata-cache.ts";
import { Vault } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import type { Workspace } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import {
  DEFAULT_PROFILE,
  parseProfileStamp,
} from "@zotlit/obsidian-kit/profile-stamp.ts";
import type {
  ProfileId,
  ProfileSelector,
} from "@zotlit/obsidian-kit/profile-stamp.ts";
import { ensureVaultParentFolder } from "@zotlit/obsidian-kit/vault-folder.ts";
import {
  FIELD_LITERATURE_NOTE_PROFILE,
  FIELD_ZOTERO_KEY,
} from "@zotlit/plugin-kernel/constants.ts";
import { recover } from "@zotlit/plugin-kernel/effect-cause.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import { filterTag } from "@zotlit/plugin-kernel/effect-stream.ts";
import { toInstant } from "@zotlit/plugin-kernel/worker/effect-clock.ts";
import type { Settings } from "@zotlit/plugin-services/core/settings/schema.ts";
import { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import { AttachmentImport } from "@zotlit/plugin-services/desktop/attachment-import/service.ts";
import type { AttachmentImportBatch } from "@zotlit/plugin-services/desktop/attachment-import/service.ts";
import {
  itemKeyFromFrontmatter,
  noteKeyFromFrontmatter,
  NoteIndex,
} from "@zotlit/plugin-services/obsidian/note-index/service.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import type { UpdateScope } from "@zotlit/protocol";
import { evalManagedFrontmatterEntries } from "@zotlit/templates/frontmatter";
import { replaceManagedRegion } from "@zotlit/templates/obsidian";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";
import type { ZoteroReadsApi } from "@zotlit/zotero-reads/client/service.ts";

import { buildNoteResolvers, itemFacets } from "./context.ts";
import type { NoteResolverServices } from "./context.ts";
import {
  composeWarn,
  frontmatterRefusal,
  NO_BODY_UPDATE,
  refusedCreate,
  refusedMissingDocument,
  refusedProfileConflict,
  refusedTemplateConversion,
  refusedUnknownProfile,
  refusedUpdateMissingDocument,
  refusedUpdateProfile,
  refusedUpdateProfileConflict,
  refusedUpdateTemplateConversion,
} from "./diagnostics.ts";
import type {
  CreateNoteInternalOptions,
  CreateNoteResult,
  NoteFeatureEvent,
  NoteKeyChangedDiagnostic,
  NoteProfileChangedDiagnostic,
  UpdateResult,
  WriteNoteUpdateOptions,
} from "./types.ts";

import { prepareManagedFrontmatter } from "#core/note-feature/frontmatter.ts";
import { InertTemplateError } from "#core/template/errors.ts";
import {
  applyComposedFrontmatter,
  composeLiteratureNote,
} from "#obsidian/note-feature/compose.ts";
import {
  ItemNotFound,
  NoteWriteAborted,
  ProfileSwitchRollbackFailed,
} from "#obsidian/note-feature/errors.ts";
import { resolveNotePath } from "#obsidian/note-feature/note-path.ts";
import {
  readItem,
  relocationSource,
  resolveProfileDocument,
} from "#obsidian/note-feature/note-reads.ts";
import { noteProfileSelector } from "#obsidian/profile/bindings.ts";
import { relocatedNotePath } from "#obsidian/profile/relocation.ts";
import { Profile } from "#obsidian/profile/service.ts";
import { Template } from "#obsidian/template/service.ts";
import { syncTemplate } from "#obsidian/template/sync-template.ts";

const logged = withLogCategory("note-feature");

export type NoteWriteServices =
  | AttachmentImport
  | ExcerptPreparation
  | FileManager
  | MetadataCache
  | NoteIndex
  | PluginSettings
  | Profile
  | Template
  | Vault
  | Workspace
  | ZoteroPref
  | ZoteroReads;

export interface NoteWriteContext {
  readonly emit: (event: NoteFeatureEvent) => void;
}

type CreateNoteWriteOptions = CreateNoteInternalOptions & {
  onFileCreated?: (file: TFile) => Effect.Effect<void>;
};

export const composeEvents = (
  ctx: NoteWriteContext,
): NonNullable<ComposeNoteDeps["events"]> => ({
  emit: (_event, payload) =>
    ctx.emit({ _tag: "frontmatter-eval-failed", payload }),
});

const withReads = <A, E, R>(
  provided: ZoteroReadsApi | undefined,
  use: (reads: ZoteroReadsApi) => Effect.Effect<A, E, R>,
) =>
  provided
    ? use(provided)
    : Effect.scoped(
        Effect.flatMap(
          Effect.flatMap(ZoteroReads, (zoteroReads) => zoteroReads.snapshot),
          (reads) => use(reads),
        ),
      );

const noteResolvers = Effect.fnUntraced(function* (
  options: Omit<
    Parameters<typeof buildNoteResolvers>[1],
    "zoteroPref" | "link"
  >,
) {
  const { dataDir, baseAttachmentPath } = yield* (yield* ZoteroPref).current;
  return buildNoteResolvers(
    Effect.runSyncWith(yield* Effect.context<NoteResolverServices>()),
    {
      ...options,
      zoteroPref: { dataDir, baseAttachmentPath },
      link: yield* markdownLinker,
    },
  );
});

const aborted = (path: string, cause: unknown) =>
  cause instanceof InertTemplateError
    ? cause
    : new NoteWriteAborted({ path, cause });

const renderFor = (path: string, render: () => string) =>
  Effect.try({ try: render, catch: (cause) => aborted(path, cause) });

export const createNote = Effect.fnUntraced(function* (
  ctx: NoteWriteContext,
  item: Item,
  options: CreateNoteWriteOptions = {},
) {
  const noteIndex = yield* NoteIndex;
  const profiles = yield* Profile;
  yield* noteIndex.whenIndexed;
  const settings = yield* (yield* PluginSettings).current;
  const requestedProfile = options.profile ?? DEFAULT_PROFILE;
  const profile = yield* profiles.resolveProfile(requestedProfile);
  if (!profile) {
    return refusedUnknownProfile(requestedProfile, {
      indexedKey: item.indexedKey,
    }) satisfies CreateNoteResult;
  }
  if (conversionRequired(settings, requestedProfile)) {
    return refusedTemplateConversion(requestedProfile, {
      indexedKey: item.indexedKey,
    }) satisfies CreateNoteResult;
  }
  const existing = yield* noteIndex.getNotesByItemKey(item.indexedKey);
  if (existing.length > 0) {
    if (existing.length === 1 && options.profile !== undefined) {
      const result = yield* profiles.profileOf(existing[0]);
      if (!result.ok) {
        return refusedUnknownProfile(result.stamped.stamp, {
          indexedKey: item.indexedKey,
          path: existing[0]!.path,
        }) satisfies CreateNoteResult;
      }
      if (result.profile.selector !== requestedProfile) {
        return refusedProfileConflict(item.indexedKey, existing[0]!, {
          existingProfile: result.profile.selector,
          requestedProfile,
        });
      }
    }
    return refusedCreate(item.indexedKey, existing);
  }
  const document = yield* resolveProfileDocument(profile);
  if (document === null) {
    return refusedMissingDocument(profile.document!, {
      indexedKey: item.indexedKey,
    }) satisfies CreateNoteResult;
  }
  return yield* withReads(options.reads, (reads) =>
    Effect.gen(function* () {
      const source = yield* readNoteSource(reads, item.itemID, {
        username: options.username,
      });
      if (!source)
        return yield* new ItemNotFound({
          indexedKey: item.indexedKey,
          message: `Zotero item not found: ${item.indexedKey}`,
        });
      const { itemTags, itemCollections } = itemFacets(source);
      const { path } =
        options.preparedPath ??
        (yield* resolveNotePath(source.item, {
          itemTags,
          itemCollections,
          settings: profile.settings,
          document,
        }));
      const vault = yield* Vault;
      return yield* writeNewNote(ctx, item, {
        reads,
        source,
        path,
        settings: profile.settings,
        profile,
        document,
        onFileCreated: options.onFileCreated,
        reportExcerpts: options.reportExcerpts,
        outcomes: options.outcomes,
        createFile: (content) =>
          Effect.andThen(
            ensureVaultParentFolder(path),
            vault.create(path, content),
          ),
      });
    }),
  );
});

const writeNewNote = Effect.fnUntraced(function* <E>(
  ctx: NoteWriteContext,
  item: Item,
  options: {
    reads: ZoteroReadsApi;
    source: NoteSource;
    path: string;
    settings: Readonly<Settings>;
    profile: ResolvedProfile;
    document: ResolvedLiteratureNoteTemplate | undefined;
    onFileCreated?: (file: TFile) => Effect.Effect<void>;
    createFile: (content: string) => Effect.Effect<TFile, E, Vault>;
    reportExcerpts?: (summary: ExcerptSummary) => void;
    outcomes?: ExcerptOutcomeScope;
  },
) {
  const { path, settings } = options;
  yield* ensureVaultParentFolder(path);
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const outcomes = yield* outcomeScope(options.outcomes);
      const excerptImages = yield* (yield* ExcerptPreparation).forNote({
        reads: options.reads,
        notePath: path,
        settings,
        outcomes,
      });
      const attachmentImport = yield* (yield* AttachmentImport).prepare(path);
      const resolvers = yield* noteResolvers({
        attachmentImport,
        settings,
        sourcePath: path,
        excerptImages,
      });
      const context = buildNoteContextFromSource(options.source, resolvers);
      yield* excerptImages.prepare;
      const template = yield* syncTemplate;
      const warn = yield* composeWarn;
      const now = toInstant(yield* DateTime.now);
      const composed = yield* Effect.try({
        try: () =>
          composeLiteratureNote(
            { template, warn, events: composeEvents(ctx) },
            {
              context,
              itemKey: item.indexedKey,
              profile: options.profile,
              document: options.document,
              now,
            },
          ),
        catch: (cause) => aborted(path, cause),
      });
      if (composed.outcome === "refused") {
        const refused: CreateNoteResult = {
          outcome: "refused",
          diagnostic: yield* frontmatterRefusal(composed.failures, {
            itemKey: item.indexedKey,
            diagnosticContext: { indexedKey: item.indexedKey },
          }),
        };
        return refused;
      }

      const file = yield* Effect.uninterruptible(
        Effect.gen(function* () {
          const file = yield* options.createFile(composed.content);
          if (options.onFileCreated) yield* options.onFileCreated(file);
          yield* flushNoteAttachments(ctx, {
            attachmentImport,
            excerptImages,
            reportExcerpts: options.reportExcerpts,
          });
          return file;
        }),
      );
      yield* Effect.logDebug("Created literature note").pipe(
        Effect.annotateLogs({ path: file.path, itemKey: item.indexedKey }),
        logged,
      );
      const created: CreateNoteResult = { outcome: "created", file };
      return created;
    }),
  );
});

export interface UpdateNoteOptions {
  indexedKey: string;
  scope?: UpdateScope;
  profile?: ProfileSelector;
  beforeWrite?: () => void;
  outcomes?: ExcerptOutcomeScope;
}

export const updateNote = Effect.fnUntraced(function* (
  ctx: NoteWriteContext,
  file: TFile,
  options: UpdateNoteOptions,
) {
  const { indexedKey, scope = "full" } = options;
  const profiles = yield* Profile;
  yield* (yield* NoteIndex).whenIndexed;
  const settings = yield* (yield* PluginSettings).current;
  const existing = yield* profiles.profileOf(file);
  const existingSelector = noteProfileSelector(existing);
  if (options.profile !== undefined && existingSelector !== undefined) {
    const requestedProfile = options.profile;
    if (!(yield* profiles.resolveProfile(requestedProfile))) {
      return refusedUpdateProfile(requestedProfile, file.path);
    }
    if (requestedProfile !== existingSelector) {
      return refusedUpdateProfileConflict(indexedKey, file.path, {
        existingProfile: existingSelector,
        requestedProfile,
      });
    }
  }
  if (!existing.ok) {
    return refusedUpdateProfile(existing.stamped.stamp, file.path);
  }
  const profile = existing.profile;
  if (conversionRequired(settings, profile.selector)) {
    return refusedUpdateTemplateConversion(profile.selector, file.path);
  }
  const document = yield* resolveProfileDocument(profile);
  if (document === null) {
    return refusedUpdateMissingDocument(profile.document!, file.path);
  }
  const attachmentImport = yield* (yield* AttachmentImport).prepare(file.path);
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const reads = yield* (yield* ZoteroReads).snapshot;
      const outcomes = yield* outcomeScope(options.outcomes);
      const { context, excerptImages } = yield* contextForIndexedKey(
        ctx,
        indexedKey,
        {
          reads,
          attachmentImport,
          sourcePath: file.path,
          settings: profile.settings,
          previousNote: scope === "full" ? file : undefined,
          outcomes,
        },
      );
      return yield* applyManagedUpdate(ctx, file, {
        context,
        attachmentImport,
        itemKey: indexedKey,
        scope,
        profile,
        document,
        beforeWrite: options.beforeWrite,
        excerptImages,
      });
    }),
  );
});

const NO_KEYS: ReadonlySet<string> = new Set();

export const replacedKeys = (ctx: NoteWriteContext, file: TFile) =>
  readReplacedKeys(ctx, file).pipe(
    recover(
      (cause) =>
        Effect.logDebug(
          "Could not read the keys a note's Profile replaces",
        ).pipe(
          Effect.annotateLogs({ path: file.path, error: Cause.squash(cause) }),
          logged,
        ),
      Effect.succeed(NO_KEYS),
    ),
  );

const readReplacedKeys = Effect.fnUntraced(function* (
  ctx: NoteWriteContext,
  file: TFile,
) {
  const settings = yield* (yield* PluginSettings).current;
  const cache = yield* parsedCache(file);
  const resolved = yield* (yield* Profile).profileOf(file);
  if (!resolved.ok) return NO_KEYS;
  const { profile } = resolved;
  if (conversionRequired(settings, profile.selector)) return NO_KEYS;
  const document = yield* resolveProfileDocument(profile);
  if (document === null) return NO_KEYS;
  if (document === undefined) {
    const fields = yield* (yield* Template).frontmatterFields;
    return new Set(
      fields.flatMap(({ key, merge }) => (merge === "replace" ? [key] : [])),
    );
  }
  const entries = document.frontmatter?.compiled ?? [];
  const keys = new Set(
    entries.flatMap(({ key, merge }) =>
      key !== undefined && merge === "replace" ? [key] : [],
    ),
  );
  const spreads = entries.filter(
    ({ key, merge }) => key === undefined && merge === "replace",
  );
  const indexedKey = itemKeyFromFrontmatter(cache);
  if (spreads.length === 0 || !indexedKey) return keys;
  const attachmentImport = yield* (yield* AttachmentImport).prepare(file.path);
  yield* Effect.scoped(
    Effect.gen(function* () {
      const reads = yield* (yield* ZoteroReads).snapshot;
      const { context } = yield* contextForIndexedKey(ctx, indexedKey, {
        reads,
        attachmentImport,
        sourcePath: file.path,
        settings: profile.settings,
      });
      const evaluation = evalManagedFrontmatterEntries(
        spreads,
        context,
        toInstant(yield* DateTime.now),
      );
      for (const { key } of evaluation.values) keys.add(key);
    }),
  ).pipe(Effect.ensuring(attachmentImport.discard));
  return keys;
});

const parsedCache = Effect.fnUntraced(function* (file: TFile) {
  const metadata = yield* MetadataCache;
  const parsed = yield* filterTag(metadata.changes, "changed").pipe(
    Stream.filter((event) => event.file.path === file.path),
    Stream.runHead,
    Effect.forkChild({ startImmediately: true }),
  );
  const cache = yield* metadata.fileCache(file);
  if (cache !== null) {
    yield* Fiber.interrupt(parsed);
    return cache;
  }
  const event = yield* Fiber.join(parsed);
  if (Option.isNone(event)) return yield* Effect.interrupt;
  return event.value.cache;
});

export const switchNoteProfile = Effect.fnUntraced(function* (
  file: TFile,
  options: {
    profile: ProfileSelector;
    importedNotes?: readonly TFile[];
    move?: boolean;
  },
) {
  const settings = yield* (yield* PluginSettings).current;
  const profiles = yield* Profile;
  const fileManager = yield* FileManager;
  const selector = options.profile;
  const profile = yield* profiles.resolveProfile(selector);
  if (!profile) return refusedUpdateProfile(selector, file.path);
  if (conversionRequired(settings, selector)) {
    return refusedUpdateTemplateConversion(selector, file.path);
  }
  const document = yield* resolveProfileDocument(profile);
  if (document === null) {
    return refusedUpdateMissingDocument(profile.document!, file.path);
  }
  const previousPath = file.path;
  const imported =
    noteKeyFromFrontmatter(yield* (yield* MetadataCache).fileCache(file)) !==
    null;
  const targetPath = relocatedNotePath(file, {
    from: relocationSource(yield* profiles.profileOf(file)),
    to: profile,
    imported,
  });
  const move = options.move === true && targetPath !== previousPath;
  yield* Effect.uninterruptible(
    Effect.gen(function* () {
      if (move) {
        yield* ensureVaultParentFolder(targetPath);
        yield* fileManager.renameFile(file, targetPath);
      }
      yield* stampNoteFamily(
        [file, ...(options.importedNotes ?? [])],
        profile.stamp,
      ).pipe(
        Effect.catch((error) =>
          move
            ? fileManager.renameFile(file, previousPath).pipe(
                Effect.mapError(
                  (rollbackError) =>
                    new ProfileSwitchRollbackFailed({
                      message: "Profile switch and folder move rollback failed",
                      cause: new AggregateError([error, rollbackError]),
                    }),
                ),
                Effect.andThen(Effect.fail(error)),
              )
            : Effect.fail(error),
        ),
      );
    }),
  );
  yield* Effect.logDebug(
    "Switched Literature Note Profile for the next update",
  ).pipe(
    Effect.annotateLogs({
      path: file.path,
      selector,
      importedNotes: options.importedNotes?.length ?? 0,
      moved: move,
    }),
    logged,
  );
  return NO_BODY_UPDATE;
});

const stampNoteFamily = Effect.fnUntraced(function* (
  files: readonly TFile[],
  stamp: string | undefined,
) {
  const previous: { file: TFile; stamp: unknown }[] = [];
  yield* Effect.forEach(
    files,
    (file, index) =>
      stampNoteProfile(file, stamp, (previousStamp) => {
        previous[index] = { file, stamp: previousStamp };
      }),
    { discard: true },
  ).pipe(
    Effect.catch((error) =>
      Effect.gen(function* () {
        const rollbacks = yield* Effect.forEach(
          previous.toReversed(),
          ({ file, stamp }) => Effect.result(stampNoteProfile(file, stamp)),
        );
        const rollbackErrors = rollbacks.flatMap((rollback) =>
          Result.isFailure(rollback) ? [rollback.failure] : [],
        );
        if (rollbackErrors.length > 0)
          return yield* new ProfileSwitchRollbackFailed({
            message: "Note Profile switch and rollback failed",
            cause: new AggregateError([error, ...rollbackErrors]),
          });
        return yield* Effect.fail(error);
      }),
    ),
  );
});

const stampNoteProfile = (
  file: TFile,
  stamp: unknown,
  capturePrevious?: (stamp: unknown) => void,
) =>
  rewriteLiveText(file, (text) => {
    const fm = parseFrontMatter(text);
    capturePrevious?.(fm[FIELD_LITERATURE_NOTE_PROFILE]);
    if (stamp === undefined) delete fm[FIELD_LITERATURE_NOTE_PROFILE];
    else fm[FIELD_LITERATURE_NOTE_PROFILE] = stamp;
    return spliceFrontMatter(text, fm);
  });

const rewriteLiveText = (file: TFile, fn: (text: string) => string) =>
  processLiveText(file, fn).pipe(
    Effect.catchTag("LiveTextRewriteFailed", ({ path, cause }) =>
      Effect.fail(aborted(path, cause)),
    ),
  );

export const writeNoteUpdate = Effect.fnUntraced(function* (
  ctx: NoteWriteContext,
  file: TFile,
  options: WriteNoteUpdateOptions,
) {
  const profiles = yield* Profile;
  const existing = yield* profiles.profileOf(file);
  const existingSelector = noteProfileSelector(existing);
  if (options.profile !== undefined && existingSelector !== undefined) {
    const requestedProfile = options.profile;
    if (!(yield* profiles.resolveProfile(requestedProfile))) {
      return refusedUpdateProfile(requestedProfile, file.path);
    }
    if (requestedProfile !== existingSelector) {
      return refusedUpdateProfileConflict(options.item.indexedKey, file.path, {
        existingProfile: existingSelector,
        requestedProfile,
      });
    }
  }
  if (!existing.ok) {
    return refusedUpdateProfile(existing.stamped.stamp, file.path);
  }
  const profile = existing.profile;
  if (conversionRequired(options.settings, profile.selector)) {
    return refusedUpdateTemplateConversion(profile.selector, file.path);
  }
  const document = yield* resolveProfileDocument(profile);
  if (document === null) {
    return refusedUpdateMissingDocument(profile.document!, file.path);
  }
  const attachmentImport = yield* (yield* AttachmentImport).prepare(file.path);
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const outcomes = yield* outcomeScope(options.outcomes);
      const source = yield* readNoteSource(options.reads, options.item.itemID, {
        username: options.username,
      });
      if (!source)
        return yield* new ItemNotFound({
          indexedKey: options.item.indexedKey,
          message: `Zotero item not found: ${options.item.indexedKey}`,
        });
      const excerptImages =
        options.scope !== "metadata"
          ? yield* (yield* ExcerptPreparation).forNote({
              reads: options.reads,
              notePath: file.path,
              settings: profile.settings,
              previousNote: file,
              outcomes,
            })
          : undefined;
      const resolvers = yield* noteResolvers({
        attachmentImport,
        settings: profile.settings,
        sourcePath: file.path,
        excerptImages,
      });
      const context = buildNoteContextFromSource(source, resolvers);
      return yield* applyManagedUpdate(ctx, file, {
        context,
        attachmentImport,
        itemKey: options.item.indexedKey,
        reportExcerpts: options.reportExcerpts,
        scope: options.scope ?? "full",
        profile,
        document,
        excerptImages,
      });
    }),
  );
});

const applyManagedUpdate = Effect.fnUntraced(function* (
  ctx: NoteWriteContext,
  file: TFile,
  input: {
    context: NoteTemplateContext;
    attachmentImport: Pick<AttachmentImportBatch, "flush">;
    itemKey: string;
    scope: UpdateScope;
    profile: ResolvedProfile;
    document: ResolvedLiteratureNoteTemplate | undefined;
    beforeWrite?: () => void;
    excerptImages?: PreparedExcerpts;
    reportExcerpts?: (summary: ExcerptSummary) => void;
  },
) {
  const { context, itemKey, scope, profile, document, beforeWrite } = input;
  const prepared = yield* prepareFrontmatter({
    context,
    itemKey,
    document,
    diagnosticContext: { path: file.path },
  });
  if ("diagnostic" in prepared)
    return { ...NO_BODY_UPDATE, diagnostic: prepared.diagnostic };
  const { excerptImages } = input;
  if (excerptImages) yield* excerptImages.prepare;
  const noManagedBlock =
    scope === "full" && document !== undefined && !document.hasManagedBlock;
  const template = yield* syncTemplate;
  const renderRegion =
    scope === "full" && !noManagedBlock
      ? () =>
          document
            ? document.renderForUpdate(context)!
            : template.renderManagedContent(context)
      : undefined;
  let replaced = false;
  let duplicateCount = 0;
  const refused = yield* Effect.uninterruptible(
    Effect.gen(function* () {
      const refused = yield* rewriteNote(ctx, file, {
        context,
        itemKey,
        profile,
        prepared,
        beforeWrite,
        body: (body) => {
          if (renderRegion === undefined) return body;
          const result = replaceManagedRegion(body, renderRegion);
          replaced = result.replaced;
          duplicateCount = result.duplicateCount;
          return result.content;
        },
      });
      if (!refused) yield* flushNoteAttachments(ctx, input);
      return refused;
    }),
  );
  if (refused) return { ...NO_BODY_UPDATE, diagnostic: refused };
  if (duplicateCount > 0) {
    yield* Effect.logWarning(
      "Literature note has duplicate managed regions",
    ).pipe(
      Effect.annotateLogs({
        path: file.path,
        itemKey,
        count: duplicateCount + 1,
      }),
      logged,
    );
  }

  yield* Effect.logDebug("Updated literature note").pipe(
    Effect.annotateLogs({
      path: file.path,
      itemKey,
      scope,
      bodyUpdated: replaced,
    }),
    logged,
  );
  const result: UpdateResult = {
    bodyUpdated: replaced,
    duplicateRegionCount: duplicateCount,
    ...(noManagedBlock && { noManagedBlock: true }),
  };
  return result;
});

interface OverwriteNoteOptions {
  indexedKey: string;
  outcomes?: ExcerptOutcomeScope;
}

export const overwriteNote = Effect.fnUntraced(function* (
  ctx: NoteWriteContext,
  file: TFile,
  options: OverwriteNoteOptions,
) {
  const { indexedKey } = options;
  yield* (yield* NoteIndex).whenIndexed;
  const settings = yield* (yield* PluginSettings).current;
  const result = yield* (yield* Profile).profileOf(file);
  if (!result.ok) return refusedUpdateProfile(result.stamped.stamp, file.path);
  const profile = result.profile;
  if (conversionRequired(settings, profile.selector)) {
    return refusedUpdateTemplateConversion(profile.selector, file.path);
  }
  const document = yield* resolveProfileDocument(profile);
  if (document === null) {
    return refusedUpdateMissingDocument(profile.document!, file.path);
  }
  const attachmentImport = yield* (yield* AttachmentImport).prepare(file.path);
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const reads = yield* (yield* ZoteroReads).snapshot;
      const outcomes = yield* outcomeScope(options.outcomes);
      const { context, excerptImages } = yield* contextForIndexedKey(
        ctx,
        indexedKey,
        {
          reads,
          attachmentImport,
          sourcePath: file.path,
          settings: profile.settings,
          previousNote: file,
          outcomes,
        },
      );
      const prepared = yield* prepareFrontmatter({
        context,
        itemKey: indexedKey,
        document,
        diagnosticContext: { path: file.path },
      });
      if ("diagnostic" in prepared)
        return { ...NO_BODY_UPDATE, diagnostic: prepared.diagnostic };
      if (excerptImages) yield* excerptImages.prepare;
      const body = document
        ? yield* renderFor(file.path, () => document.renderForCreate(context))
        : yield* (yield* Template).render("note", context);
      const refused = yield* Effect.uninterruptible(
        Effect.gen(function* () {
          const refused = yield* rewriteNote(ctx, file, {
            context,
            itemKey: indexedKey,
            profile,
            prepared,
            body: () => body,
          });
          if (!refused)
            yield* flushNoteAttachments(ctx, {
              attachmentImport,
              excerptImages,
            });
          return refused;
        }),
      );
      if (refused) return { ...NO_BODY_UPDATE, diagnostic: refused };

      yield* Effect.logInfo("Overwrote literature note").pipe(
        Effect.annotateLogs({ path: file.path, itemKey: indexedKey }),
        logged,
      );
      const overwritten: UpdateResult = {
        bodyUpdated: true,
        duplicateRegionCount: 0,
      };
      return overwritten;
    }),
  );
});

const flushNoteAttachments = (
  ctx: NoteWriteContext,
  input: {
    attachmentImport: Pick<AttachmentImportBatch, "flush">;
    excerptImages?: PreparedExcerpts;
    reportExcerpts?: (summary: ExcerptSummary) => void;
  },
) =>
  Effect.suspend(() => {
    const summary = input.excerptImages?.summary();
    const report = summary && nonEmptySummary(summary);
    return input.attachmentImport.flush.pipe(
      Effect.ensuring(
        Effect.sync(() => {
          if (!report) return;
          if (input.reportExcerpts) input.reportExcerpts(report);
          else ctx.emit({ _tag: "excerpt-images-reported", payload: report });
        }),
      ),
    );
  });

const contextForIndexedKey = Effect.fnUntraced(function* (
  ctx: NoteWriteContext,
  indexedKey: string,
  options: {
    reads: ZoteroReadsApi;
    attachmentImport: Pick<AttachmentImportBatch, "decide" | "resolveLink">;
    sourcePath: string;
    settings: Readonly<Settings>;
    previousNote?: TFile;
    outcomes?: ExcerptOutcomeScope;
  },
) {
  const { reads, sourcePath, settings } = options;
  const item = yield* readItem(reads, indexedKey);
  const source = item && (yield* readNoteSource(reads, item.itemID));
  if (!source)
    return yield* new ItemNotFound({
      indexedKey,
      message: `Zotero item not found: ${indexedKey}`,
    });
  const excerptImages = options.previousNote
    ? yield* (yield* ExcerptPreparation).forNote({
        reads,
        notePath: sourcePath,
        settings,
        previousNote: options.previousNote,
        outcomes: options.outcomes,
      })
    : undefined;
  const resolvers = yield* noteResolvers({
    attachmentImport: options.attachmentImport,
    settings,
    sourcePath,
    excerptImages,
  });
  const context = buildNoteContextFromSource(source, resolvers);
  return { context, excerptImages };
});

const readNoteSource = (
  reads: ZoteroReadsApi,
  itemID: number,
  options: { username?: string | null } = {},
) =>
  reads.NoteSource({
    itemID,
    ...(options.username !== undefined && { username: options.username }),
  });

const rewriteNote = Effect.fnUntraced(function* (
  ctx: NoteWriteContext,
  file: TFile,
  input: ComposeFrontmatterInput & {
    profile: Pick<ResolvedProfile, "selector">;
    beforeWrite?: () => void;
    body: (body: string) => string;
  },
) {
  const template = yield* syncTemplate;
  const warn = yield* composeWarn;
  let changed: "key" | "profile" | undefined;
  yield* rewriteLiveText(file, (content) => {
    const fm = parseFrontMatter(content);
    changed = undefined;
    if (fm[FIELD_ZOTERO_KEY] !== input.itemKey) changed = "key";
    else if (stampedSelector(fm) !== input.profile.selector)
      changed = "profile";
    if (changed) return content;
    input.beforeWrite?.();
    applyComposedFrontmatter(
      { template, warn, events: composeEvents(ctx) },
      fm,
      input,
    );
    const { contentStart } = getFrontMatterInfo(content);
    return (
      spliceFrontMatter(content.slice(0, contentStart), fm) +
      input.body(content.slice(contentStart))
    );
  });
  if (changed === "key") {
    const diagnostic: NoteKeyChangedDiagnostic = {
      code: "literature-note-key-changed",
      hint: "The note's Zotero key changed while the update ran. Run the update again from the note.",
      indexedKey: input.itemKey,
      path: file.path,
    };
    return diagnostic;
  }
  if (changed === "profile") {
    const diagnostic: NoteProfileChangedDiagnostic = {
      code: "literature-note-profile-changed",
      hint: "The note's Profile stamp changed while the update ran. Run the update again from the note.",
      indexedKey: input.itemKey,
      path: file.path,
    };
    return diagnostic;
  }
  return undefined;
});

function stampedSelector(
  fm: Record<string, unknown>,
): ProfileSelector | undefined {
  const stamped = parseProfileStamp(fm[FIELD_LITERATURE_NOTE_PROFILE]);
  return stamped === undefined ? DEFAULT_PROFILE : stamped.id;
}

const prepareFrontmatter = Effect.fnUntraced(function* (input: {
  context: NoteTemplateContext;
  itemKey: string;
  document: ResolvedLiteratureNoteTemplate | undefined;
  diagnosticContext: { path?: string; indexedKey?: string };
}) {
  const result = prepareManagedFrontmatter(
    input.document?.frontmatter,
    input.context,
    toInstant(yield* DateTime.now),
  );
  if ("prepared" in result) return result.prepared;
  return { diagnostic: yield* frontmatterRefusal(result.failures, input) };
});

function conversionRequired(
  settings: Readonly<Settings>,
  selector: ProfileSelector,
): selector is ProfileId {
  return (
    settings["note.template-conversion-pending"] && selector !== DEFAULT_PROFILE
  );
}

export type CreateNoteError = Effect.Error<ReturnType<typeof createNote>>;
export type UpdateNoteError = Effect.Error<ReturnType<typeof updateNote>>;
export type SwitchNoteProfileError = Effect.Error<
  ReturnType<typeof switchNoteProfile>
>;
export type OverwriteNoteError = Effect.Error<ReturnType<typeof overwriteNote>>;
export type WriteNoteUpdateError = Effect.Error<
  ReturnType<typeof writeNoteUpdate>
>;
