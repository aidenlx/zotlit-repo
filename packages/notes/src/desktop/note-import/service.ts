import type {
  ProfileBindingSettings,
  ResolvedProfile,
} from "#obsidian/profile/bindings.ts";
import type { ProfileOperationError } from "#obsidian/profile/service.ts";
import { Context, Effect, Layer, Schema, Semaphore } from "effect";
import { normalizePath, stringifyYaml } from "obsidian";
import type { TFile } from "obsidian";

import { ExcerptPreparation } from "@zotlit/annotations/desktop/excerpt-image/prepare.ts";
import type {
  ExcerptPrepareError,
  ExcerptSummary,
  PreparedExcerpts,
} from "@zotlit/annotations/desktop/excerpt-image/prepare.ts";
import { outcomeScope } from "@zotlit/annotations/obsidian/excerpt-image/outcome-scope.ts";
import type { ExcerptOutcomeScope } from "@zotlit/annotations/obsidian/excerpt-image/outcome-scope.ts";
import type {
  AnnotationSources,
  Attachment,
  ChildNote,
  Item,
  Note,
} from "@zotlit/db";
import { processLiveText } from "@zotlit/obsidian-kit/effect-live-text.ts";
import {
  joinFolderPath,
  normalizeFolderPath,
} from "@zotlit/obsidian-kit/ensure-folder.ts";
import { Vault } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import type { Workspace } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import { unknownProfileDiagnostic } from "@zotlit/obsidian-kit/profile-stamp.ts";
import type { ProfileSelector } from "@zotlit/obsidian-kit/profile-stamp.ts";
import { formatErrorMessage } from "@zotlit/obsidian-kit/toast.ts";
import { ensureVaultFolder } from "@zotlit/obsidian-kit/vault-folder.ts";
import {
  FIELD_LITERATURE_NOTE_PROFILE,
  FIELD_ZOTERO_LASTMOD,
  FIELD_ZOTERO_NOTE_KEY,
  stringifyInstant,
} from "@zotlit/plugin-kernel/constants.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import type {
  VaultError,
  VaultFolderBlockedError,
} from "@zotlit/plugin-kernel/vault-errors.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import type { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import { AttachmentImport } from "@zotlit/plugin-services/desktop/attachment-import/service.ts";
import type {
  AttachmentFlushError,
  AttachmentImportBatch,
} from "@zotlit/plugin-services/desktop/attachment-import/service.ts";
import { libraryFilePaths } from "@zotlit/plugin-services/obsidian/library-source/paths.ts";
import { NoteIndex } from "@zotlit/plugin-services/obsidian/note-index/service.ts";
import {
  MAX_SEGMENT_BYTES,
  normalizeFilename,
  truncateToByteLimit,
} from "@zotlit/templates";
import { readDisplayRef } from "@zotlit/zotero-reads/client/display-ref.ts";
import type { ZoteroReadsApi } from "@zotlit/zotero-reads/client/service.ts";

import {
  noteAnnotationKeys,
  noteReferences,
  parseNote,
} from "./note-parser.ts";

import { randomFilenameId } from "#core/note-feature/filename.ts";
import { renderAnnotationSources } from "#desktop/template/annotation-render.ts";
import { getProfileBinding } from "#obsidian/profile/bindings.ts";
import { Profile } from "#obsidian/profile/service.ts";
import { syncTemplate } from "#obsidian/template/sync-template.ts";

const WRITE_CONCURRENCY = 16;

const SUFFIX_LENGTH = 6;
const MAX_IMPORT_BASE_BYTES = MAX_SEGMENT_BYTES - 1 - SUFFIX_LENGTH - 3;

export type WriteOutcome = "created" | "overwritten" | "skipped";

type WriteMode =
  | { action: "create"; path: string }
  | { action: "overwrite"; file: TFile };

interface RunContext {
  reads: ZoteroReadsApi;
  settings: ProfileBindingSettings;
  attachmentFolderCache: Map<string, string>;
  profile: ResolvedProfile;
  reportExcerpts?: (summary: ExcerptSummary) => void;
  outcomes: ExcerptOutcomeScope;
}

export interface ImportNoteOptions {
  reads: ZoteroReadsApi;
  settings: ProfileBindingSettings;
  attachmentFolderCache?: Map<string, string>;
  targetFile?: TFile;
  reportExcerpts?: (summary: ExcerptSummary) => void;
  outcomes?: ExcerptOutcomeScope;
}

interface PrepareExplicitImportOptions {
  reads: ZoteroReadsApi;
  orphanProfile?: ProfileSelector;
}

export type NoteImportError =
  | NoteImportProfileError
  | NoteImportMintError
  | VaultFolderBlockedError
  | ExcerptPrepareError
  | AttachmentFlushError
  | NoteImportParseError
  | Effect.Error<ReturnType<typeof readDisplayRef>>
  | ProfileOperationError
  | VaultError;

export interface PreparedExplicitImport {
  source: "existing" | "parent" | "orphan";
  profile: ResolvedProfile;
  path: string;
  import(
    note: Note,
    options: ImportNoteOptions,
  ): Effect.Effect<WriteOutcome, NoteImportError>;
}

export class NoteImporter extends Context.Service<
  NoteImporter,
  {
    prepareExplicitImport(
      note: ChildNote,
      options: PrepareExplicitImportOptions,
    ): Effect.Effect<PreparedExplicitImport, NoteImportError>;
    importNote(
      note: Note,
      options: ImportNoteOptions,
    ): Effect.Effect<WriteOutcome, NoteImportError>;
  }
>()("zotlit/obsidian/NoteImporter") {}

const logged = withLogCategory("note-import", "service");

type NoteImporterServices =
  | AttachmentImport
  | ExcerptPreparation
  | Profile
  | NoteIndex
  | Vault
  | Workspace
  | ZoteroPref;

export const layerNoteImporter = Layer.effect(
  NoteImporter,
  Effect.gen(function* () {
    const writes = yield* Semaphore.make(WRITE_CONCURRENCY);
    const context = yield* Effect.context<NoteImporterServices>();
    const templates = yield* syncTemplate;
    const ctx: Ctx = { templates };
    const run = <A, E>(effect: Effect.Effect<A, E, NoteImporterServices>) =>
      Effect.provideContext(effect, context);
    return NoteImporter.of({
      prepareExplicitImport: Effect.fn("NoteImporter.prepareExplicitImport")(
        function* (note, options) {
          const prepared = yield* run(
            prepareExplicitImport(ctx, note, options),
          );
          return {
            ...prepared,
            import: (current: Note, runOptions: ImportNoteOptions) =>
              writes.withPermits(1)(
                run(prepared.importNow(current, runOptions)),
              ),
          };
        },
      ),
      importNote: Effect.fn("NoteImporter.importNote")((note, options) =>
        writes.withPermits(1)(run(doImportNote(ctx, note, options))),
      ),
    });
  }),
);

interface Ctx {
  readonly templates: Effect.Success<typeof syncTemplate>;
}

const doImportNote = Effect.fnUntraced(function* (
  ctx: Ctx,
  note: Note,
  options: ImportNoteOptions,
) {
  const { existing, profile } = yield* explicitImportTarget(note, options);
  if (existing)
    return yield* writeScoped(ctx, note, {
      mode: { action: "overwrite", file: existing },
      profile,
      options,
    });
  const folder = yield* ensureImportFolder(
    getProfileBinding(profile.settings, "note.import-folder"),
  );
  return yield* writeScoped(ctx, note, {
    mode: { action: "create", path: yield* mintImportPath(folder, note) },
    profile,
    options,
  });
});

const writeScoped = (
  ctx: Ctx,
  note: Note,
  {
    mode,
    profile,
    options,
  }: { mode: WriteMode; profile: ResolvedProfile; options: ImportNoteOptions },
) =>
  Effect.scoped(
    Effect.gen(function* () {
      return yield* writeNote(ctx, note, {
        mode,
        run: {
          reads: options.reads,
          settings: profile.settings,
          attachmentFolderCache: options.attachmentFolderCache ?? new Map(),
          profile,
          reportExcerpts: options.reportExcerpts,
          outcomes: yield* outcomeScope(options.outcomes),
        },
      });
    }),
  );

const prepareExplicitImport = Effect.fnUntraced(function* (
  ctx: Ctx,
  note: ChildNote,
  options: PrepareExplicitImportOptions,
) {
  const { existing, profile, source, sourcePath } = yield* explicitImportTarget(
    note,
    options,
  );
  const { orphanProfile } = options;
  const path =
    existing?.path ??
    (yield* mintImportPath(
      getProfileBinding(profile.settings, "note.import-folder"),
      note,
    ));
  yield* Effect.logDebug("Prepared explicit note import").pipe(
    Effect.annotateLogs({
      indexedKey: note.indexedKey,
      path,
      profile: profile.selector,
    }),
    logged,
  );
  const importNow = Effect.fnUntraced(function* (
    current: Note,
    runOptions: ImportNoteOptions,
  ) {
    const target = yield* explicitImportTarget(current, {
      reads: runOptions.reads,
      orphanProfile,
    });
    if (
      target.source !== source ||
      target.sourcePath !== sourcePath ||
      target.profile.selector !== profile.selector
    ) {
      yield* Effect.logDebug(
        "Explicit note import source changed; skipped",
      ).pipe(
        Effect.annotateLogs({
          indexedKey: current.indexedKey,
          path,
          source,
          currentSource: target.source,
          profile: profile.selector,
          currentProfile: target.profile.selector,
        }),
        logged,
      );
      const skipped: WriteOutcome = "skipped";
      return skipped;
    }
    if (!existing)
      yield* ensureImportFolder(
        getProfileBinding(profile.settings, "note.import-folder"),
      );
    return yield* writeScoped(ctx, current, {
      mode: existing
        ? { action: "overwrite", file: existing }
        : { action: "create", path },
      profile,
      options: runOptions,
    });
  });
  return { source, profile, path, importNow };
});

const explicitImportTarget = Effect.fnUntraced(function* (
  note: ChildNote,
  options: PrepareExplicitImportOptions & { targetFile?: TFile },
) {
  const vault = yield* Vault;
  const noteIndex = yield* NoteIndex;
  const profiles = yield* Profile;
  const existing =
    (options.targetFile
      ? yield* vault.getFileByPath(options.targetFile.path)
      : null) ??
    (yield* noteIndex.getImportedNoteByNoteKey(note.indexedKey))[0];
  const file = existing ?? (yield* parentLiteratureNote(note, options));
  const source: PreparedExplicitImport["source"] = existing
    ? "existing"
    : file
      ? "parent"
      : "orphan";
  if (!file && options.orphanProfile !== undefined) {
    const profile = yield* profiles.resolveProfile(options.orphanProfile);
    if (!profile)
      return yield* NoteImportProfileError.unknown(options.orphanProfile, {
        indexedKey: note.indexedKey,
      });
    return { existing, profile, source, sourcePath: undefined };
  }
  const resolved = yield* profiles.profileOf(file);
  if (!resolved.ok)
    return yield* NoteImportProfileError.unknown(resolved.stamped.stamp, {
      path: file?.path,
      indexedKey: note.indexedKey,
      imported: existing !== undefined,
    });
  return {
    existing,
    profile: resolved.profile,
    source,
    sourcePath: file?.path,
  };
});

const writeNote = Effect.fnUntraced(function* (
  ctx: Ctx,
  note: Note,
  { mode, run }: { mode: WriteMode; run: RunContext },
) {
  const path = mode.action === "create" ? mode.path : mode.file.path;

  let body = "";
  let attachmentBatch: AttachmentImportBatch | undefined;
  let excerpts: PreparedExcerpts | undefined;
  if (note.note) {
    const html = note.note;
    const batch = yield* (yield* AttachmentImport).prepare(path, {
      folderCache: run.attachmentFolderCache,
    });
    attachmentBatch = batch;
    const templateMode = getProfileBinding(
      run.settings,
      "note.import-annotations-as-template",
    );
    const inputs = yield* readParseInputs(run.reads, note, {
      html,
      annotations: templateMode,
    });
    const annotations = inputs.annotations?.annotations;
    if (annotations?.length) {
      const prepared = yield* (yield* ExcerptPreparation).forNote({
        reads: run.reads,
        notePath: path,
        settings: run.profile.settings,
        previousNote: mode.action === "overwrite" ? mode.file : undefined,
        outcomes: run.outcomes,
      });
      excerpts = prepared;
      for (const annotation of annotations)
        prepared.annotationImageLink(annotation);
      yield* prepared.prepare;
    }
    const sources = inputs.annotations;
    const { templates } = ctx;
    const { dataDir, baseAttachmentPath } = yield* libraryFilePaths;
    const zoteroPref = { dataDir, baseAttachmentPath };
    const annotationImageLink = excerpts?.annotationImageLink;
    const renderAnnotationParagraph = sources
      ? () =>
          renderAnnotationSources(sources, {
            template: templates,
            zoteroPref,
            attachmentImport: batch,
            annotationImageLink,
            renderAnnotation: (data) =>
              templates.renderProfileAnnotation(data, {
                profile: run.profile,
              }),
          })
      : undefined;
    body = yield* Effect.try({
      try: () =>
        parseNote(TurndownService, html, {
          citedItems: inputs.citedItems,
          groupID: note.groupID,
          attachments: inputs.attachments,
          renderCite: (items) => templates.renderCitation(items, "main"),
          pathContext: zoteroPref,
          useColoredHighlightSyntax: getProfileBinding(
            run.settings,
            "note.import-colored-highlights",
          ),
          highlightMappings: run.settings["note.import-highlight-mappings"],
          attachmentImport: batch,
          renderAnnotationParagraph,
        }),
      catch: (cause) => new NoteImportParseError({ cause }),
    });
  }

  const frontmatter = {
    date: stringifyInstant(note.dateAdded),
    [FIELD_ZOTERO_NOTE_KEY]: note.indexedKey,
    [FIELD_ZOTERO_LASTMOD]: stringifyInstant(note.dateModified),
    ...(run.profile.stamp === undefined
      ? {}
      : { [FIELD_LITERATURE_NOTE_PROFILE]: run.profile.stamp }),
  };
  const content = `---\n${stringifyYaml(frontmatter)}---\n${body}`;

  return yield* Effect.uninterruptible(
    Effect.gen(function* () {
      let outcome: WriteOutcome;
      if (mode.action === "create") {
        const created = yield* (yield* Vault).create(mode.path, content).pipe(
          Effect.as(true),
          Effect.catchTag("FileExists", () => Effect.succeed(false)),
        );
        if (!created) {
          yield* Effect.logWarning(
            "Imported note already exists; skipped",
          ).pipe(Effect.annotateLogs({ path }), logged);
          const skipped: WriteOutcome = "skipped";
          return skipped;
        }
        outcome = "created";
      } else {
        yield* processLiveText(mode.file, () => content).pipe(
          Effect.catchTag("LiveTextRewriteFailed", (error) =>
            Effect.die(error),
          ),
        );
        outcome = "overwritten";
      }

      if (excerpts) run.reportExcerpts?.(excerpts.summary());
      if (attachmentBatch) {
        const copied = yield* attachmentBatch.flush;
        yield* Effect.logDebug("Imported note attachments").pipe(
          Effect.annotateLogs({
            path,
            copied: copied.copied,
            skipped: copied.skipped,
            missing: copied.missing,
          }),
          logged,
        );
      }
      return outcome;
    }),
  );
});

const parentLiteratureNote = Effect.fnUntraced(function* (
  note: ChildNote,
  options: Pick<ImportNoteOptions, "reads">,
) {
  if (note.parentItemID === null) return undefined;
  const parent = yield* readDisplayRef(options.reads, note.parentItemID);
  if (!parent) return undefined;
  const notes = yield* (yield* NoteIndex).getNotesByItemKey(parent.indexedKey);
  return notes[0];
});

interface ParseInputs {
  citedItems: ReadonlyMap<string, Item>;
  attachments: ReadonlyMap<string, Attachment>;
  annotations?: AnnotationSources;
}

const NO_ANNOTATIONS: AnnotationSources = {
  annotations: [],
  attachments: [],
  parentItems: [],
  tagsByItemID: new Map(),
  username: null,
};

const readParseInputs = Effect.fnUntraced(function* (
  reads: ZoteroReadsApi,
  note: Pick<Note, "libraryID" | "groupID">,
  options: { html: string; annotations: boolean },
) {
  const { html } = options;
  const { citedIndexedKeys, attachmentKeys } = noteReferences(
    html,
    note.groupID,
  );
  const annotationKeys = options.annotations ? noteAnnotationKeys(html) : [];
  const [citedItems, attachments, annotations] = yield* Effect.all(
    [
      citedIndexedKeys.length > 0
        ? reads.ItemsByIndexedKeys({ indexedKeys: citedIndexedKeys })
        : Effect.succeed(new Map<string, Item>()),
      attachmentKeys.length > 0
        ? reads.AttachmentsByKeys({
            libraryID: note.libraryID,
            keys: attachmentKeys,
          })
        : Effect.succeed([]),
      annotationKeys.length > 0
        ? reads.AnnotationSources({
            libraryID: note.libraryID,
            keys: annotationKeys,
          })
        : Effect.succeed(options.annotations ? NO_ANNOTATIONS : undefined),
    ],
    { concurrency: "unbounded" },
  );
  const inputs: ParseInputs = {
    citedItems,
    attachments: new Map(attachments.map((a) => [a.key, a])),
    ...(annotations && { annotations }),
  };
  return inputs;
});

export class NoteImportProfileError extends Schema.TaggedError<
  NoteImportProfileError,
  { readonly brand: unique symbol }
>()("NoteImportProfileError", {
  diagnostic: Schema.Struct({
    code: Schema.Literal("unknown-literature-note-profile"),
    hint: Schema.String,
    recovery: Schema.Struct({ action: Schema.Literal("switch-profile") }),
    stamp: Schema.String,
    path: Schema.optional(Schema.String),
    indexedKey: Schema.optional(Schema.String),
  }),
  imported: Schema.Boolean,
}) {
  static unknown(
    stamp: string,
    context: { path?: string; indexedKey?: string; imported?: boolean },
  ): NoteImportProfileError {
    const { imported = true, ...diagnosticContext } = context;
    return new NoteImportProfileError({
      diagnostic: unknownProfileDiagnostic(stamp, diagnosticContext),
      imported,
    });
  }

  override get message(): string {
    const { stamp, path, indexedKey } = this.diagnostic;
    return this.imported
      ? m.notice_imported_note_profile_unknown({
          stamp,
          target: path ?? indexedKey ?? stamp,
        })
      : m.notice_literature_note_profile_unknown({ stamp });
  }
}

export class NoteImportParseError extends Schema.TaggedError<
  NoteImportParseError,
  { readonly brand: unique symbol }
>()("NoteImportParseError", {
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return formatErrorMessage(this.cause);
  }
}

const mintImportPath = Effect.fnUntraced(function* (
  importFolder: string,
  note: Pick<Note, "title" | "indexedKey">,
) {
  const folder = normalizeFolderPath(importFolder);
  const normalized = normalizeFilename(note.title ?? "");
  const base =
    normalized === ""
      ? `zotero_note_${note.indexedKey}`
      : truncateToByteLimit(normalized, MAX_IMPORT_BASE_BYTES);
  const name = `${base}_${randomFilenameId(SUFFIX_LENGTH)}.md`;
  const path = joinFolderPath(folder, name);
  if ((yield* (yield* Vault).getAbstractFileByPath(path)) !== null)
    return yield* new NoteImportMintError({ path });
  return path;
});

const ensureImportFolder = Effect.fnUntraced(function* (
  importFolderSetting: string,
) {
  const folder = normalizeFolderPath(normalizePath(importFolderSetting));
  yield* ensureVaultFolder(folder);
  return folder;
});

export class NoteImportMintError extends Schema.TaggedError<
  NoteImportMintError,
  { readonly brand: unique symbol }
>()("NoteImportMintError", {
  path: Schema.String,
}) {
  override get message(): string {
    return `Imported note path collided with an existing file: ${this.path}`;
  }
}
