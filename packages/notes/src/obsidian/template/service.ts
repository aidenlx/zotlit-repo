import type { TemplateName } from "#core/template/defaults.ts";
import type { EngineFaultSpan } from "#core/template/errors.ts";
import type { ResolvedProfile } from "#obsidian/profile/bindings.ts";
import type { Cause } from "effect";
import {
  Context,
  Effect,
  Fiber,
  Layer,
  PubSub,
  Result,
  Scope,
  Stream,
  SubscriptionRef,
} from "effect";
import type { App, TAbstractFile } from "obsidian";
import { TFile, TFolder } from "obsidian";

import { citekeysToCiteTemplateData } from "@zotlit/db";
import type {
  CitationTemplateData,
  CitationVariant,
  CiteRef,
} from "@zotlit/db";
import {
  processLiveText,
  readLiveText,
} from "@zotlit/obsidian-kit/effect-live-text.ts";
import { obsidianEvents } from "@zotlit/obsidian-kit/effect-obsidian-events.ts";
import { ObsidianApp } from "@zotlit/obsidian-kit/obsidian-app.ts";
import { FileManager } from "@zotlit/obsidian-kit/obsidian-file-manager.ts";
import { Vault } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import type { VaultEvent } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import { Workspace } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import type { UnknownProfileDiagnostic } from "@zotlit/obsidian-kit/profile-stamp.ts";
import { ensureVaultFolder } from "@zotlit/obsidian-kit/vault-folder.ts";
import { RESERVED_KEYS } from "@zotlit/plugin-kernel/constants.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import { forkEach } from "@zotlit/plugin-kernel/effect-stream.ts";
import {
  FileExists,
  VaultError,
  VaultFolderBlockedError,
} from "@zotlit/plugin-kernel/vault-errors.ts";
import { dirname, join } from "@zotlit/plugin-kernel/vault-path.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import type { Settings } from "@zotlit/plugin-services/core/settings/schema.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import { inlineCitation } from "@zotlit/templates";
import type {
  AutoTrim,
  FrontmatterLanguage,
} from "@zotlit/templates/constants";
import {
  formatPlainTemplateDocument,
  LegacyTemplateConversionError,
  LiteratureNoteTemplateError,
  MissingTemplateError,
  parsePlainTemplateDocument,
  PlainTemplateDocumentError,
  TemplateError,
  TemplateFacade,
} from "@zotlit/templates/facade";
import type {
  ConvertedLegacyLiteratureNoteTemplate,
  LiteratureNoteTemplateDocument,
  LiteratureNoteTemplateErrorCode,
  LiteratureNoteTemplateManifest,
  RootVariableUse,
  TemplateLanguage,
} from "@zotlit/templates/facade";
import { evalFrontmatterFields } from "@zotlit/templates/frontmatter";
import type {
  CompiledFrontmatterField,
  CompiledManagedFrontmatter,
  FrontmatterField,
} from "@zotlit/templates/frontmatter";
import {
  exportLiteratureNotePack as formatLiteratureNotePack,
  LiteratureNotePackError,
  unpackLiteratureNotePartials,
} from "@zotlit/templates/literature-note-pack";
import type {
  LiteratureNotePartialUnpack,
  LiteratureNoteTemplatePartial,
} from "@zotlit/templates/literature-note-pack";
import {
  formatManagedRegion,
  managedRegionTransform,
} from "@zotlit/templates/obsidian";

import {
  CITATION_TEMPLATE_NAME,
  CITATION_TEMPLATE_SOURCE,
  citationPath,
  classifyTemplateFolderFile,
  DEFAULT_TEMPLATES,
  isLegacyCitationName,
  isTemplateName,
  MANAGED_CONTENT_TEMPLATE,
  partialNameRefusal,
  partialPath,
  RESERVED_PARTIAL_NAMES,
  templatePath,
  TEMPLATE_NAMES,
} from "#core/template/defaults.ts";
import {
  engineFaultSpan,
  InertTemplateError,
  MissingPartialError,
  PartialNameError,
  TemplateOperationError,
  TemplateRenderError,
} from "#core/template/errors.ts";
import { normalizeVaultPath } from "#core/template/path.ts";

const FLUSH_DEBOUNCE_MS = 500;
const SETTLE_TIMEOUT_MS = 5_000;
const LEGACY_LITERATURE_NOTE_TEMPLATE_NAMES: ReadonlySet<TemplateName> =
  new Set(["filename", "note", "annotation", MANAGED_CONTENT_TEMPLATE]);

const JS_TEMPLATES_STORAGE_KEY = "zotlit-javascript-templates";

const EMBEDDED_DEFAULT_WINNER = {
  language: "liquid",
  source: { kind: "embedded-default" },
} as const satisfies TemplateWinner;

interface TemplateEngineOptions {
  app: App;
  snapshot: Readonly<Settings>;
  changed: () => Effect.Effect<void>;
  flushRequested: () => void;
  intakePending: () => number;
  schedule: (millis: number, task: () => void) => Effect.Effect<() => void>;
  log: (
    level: "debug" | "info" | "warn" | "error",
    message: string,
    fields?: Record<string, unknown>,
  ) => void;
}

export interface TemplateWinner {
  language: TemplateLanguage;
  source:
    | { kind: "vault"; path: string }
    | { kind: "embedded-default" }
    | { kind: "none" };
}

export interface TemplateFileStatus {
  name: TemplateName;
  winner: TemplateWinner;
  editablePath: string;
  shadowedFiles: readonly string[];
  inertFiles: readonly string[];
  compileError: string | null;
}

export interface ResolvedLiteratureNoteTemplate {
  readonly reference: string;
  readonly path: string;
  readonly manifest: LiteratureNoteTemplateManifest;
  readonly frontmatter?: CompiledManagedFrontmatter;
  readonly hasManagedBlock: boolean;
  renderForCreate<T extends object>(data: T): string;
  renderForUpdate<T extends object>(data: T): string | null;
  renderAnnotation<T extends object>(data: T): string;
  renderFilename<T extends object>(data: T): string;
}

export type ProfileAnnotationDiagnostic =
  | UnknownProfileDiagnostic
  | {
      readonly code: "missing-literature-note-template";
      readonly document: string;
      readonly hint: string;
    };

export class ProfileAnnotationError extends Error {
  readonly _tag = "ProfileAnnotationError";
  readonly diagnostic: ProfileAnnotationDiagnostic;

  constructor(diagnostic: ProfileAnnotationDiagnostic) {
    super(
      diagnostic.code === "unknown-literature-note-profile"
        ? m.notice_literature_note_profile_unknown({
            stamp: diagnostic.stamp,
          })
        : m.notice_literature_note_template_missing({
            document: diagnostic.document,
          }),
    );
    this.name = "ProfileAnnotationError";
    this.diagnostic = diagnostic;
  }
}

export interface LiteratureNoteTemplateStatus {
  readonly reference: string;
  readonly path: string;
  readonly validation:
    | {
        readonly state: "valid";
        readonly manifest: LiteratureNoteTemplateManifest;
        readonly hasManagedBlock: boolean;
      }
    | {
        readonly state: "invalid";
        readonly manifestId?: string;
        readonly error: {
          readonly code: LiteratureNoteTemplateErrorCode | "unknown";
          readonly message: string;
          readonly recovery: string;
          readonly offset?: number;
          readonly manifestPath?: readonly (string | number)[];
          readonly cause?: unknown;
        };
      };
}

export interface ConvertedLegacyProfileDocument extends ConvertedLegacyLiteratureNoteTemplate {
  readonly legacyFiles: readonly string[];
}

export interface LegacyTemplateFile {
  readonly name: string;
  readonly path: string;
  readonly language: TemplateLanguage;
  readonly inert: boolean;
  readonly shadowed: readonly string[];
}

export interface LegacyTemplateDocuments {
  readonly citation: readonly LegacyTemplateFile[];
  readonly partials: readonly LegacyTemplateFile[];
}

export interface ConvertedLegacyTemplateDocuments {
  readonly documents: readonly {
    readonly path: string;
    readonly source: string;
  }[];
  readonly trashed: readonly string[];
  readonly kept: readonly string[];
}

interface ReconciledLiteratureNoteTemplate {
  path: string;
  document: LiteratureNoteTemplateDocument;
}

interface RegisteredPartial {
  path: string;
  language: TemplateLanguage;
  source: string;
}

interface RegisteredCitationTemplate {
  path: string | null;
  language: TemplateLanguage;
  source: string;
}

export interface SharedPartialDocument {
  readonly name: string;
  readonly path: string;
  readonly language: TemplateLanguage;
}

export interface PartialUnpackOutcome {
  readonly written: readonly string[];
  readonly kept: readonly string[];
  readonly dropped: readonly string[];
  readonly refused: readonly string[];
  readonly otherCase: readonly string[];
}

export interface CitationTemplateStatus {
  readonly path: string;
  readonly customized: boolean;
  readonly language: TemplateLanguage;
  readonly inertPath: string | null;
  readonly compileError: string | null;
}

interface TemplateWork {
  readonly names: Set<string>;
  readonly documentReferences: Set<string>;
  readonly partialNames: Set<string>;
  readonly citation: Set<string>;
  readonly unrecognizedPaths: Set<string>;
}

function emptyTemplateWork(): TemplateWork {
  return {
    names: new Set(),
    documentReferences: new Set(),
    partialNames: new Set(),
    citation: new Set(),
    unrecognizedPaths: new Set(),
  };
}

function templateWorkBuckets(work: TemplateWork): readonly Set<string>[] {
  return [
    work.names,
    work.documentReferences,
    work.partialNames,
    work.citation,
    work.unrecognizedPaths,
  ];
}

function isTemplateWorkEmpty(work: TemplateWork): boolean {
  return templateWorkBuckets(work).every((bucket) => bucket.size === 0);
}

function takeTemplateWork(pending: TemplateWork): TemplateWork {
  const work: TemplateWork = {
    names: new Set(pending.names),
    documentReferences: new Set(pending.documentReferences),
    partialNames: new Set(pending.partialNames),
    citation: new Set(pending.citation),
    unrecognizedPaths: new Set(pending.unrecognizedPaths),
  };
  for (const bucket of templateWorkBuckets(pending)) bucket.clear();
  return work;
}

function collectTemplatePath(work: TemplateWork, path: string): boolean {
  const classified = classifyTemplateFolderFile(path);
  switch (classified?.kind) {
    case "legacy-slot":
    case "legacy-citation":
    case "legacy-partial":
      work.names.add(classified.name);
      return true;
    case "profile":
      work.documentReferences.add(classified.reference);
      return true;
    case "partial":
      work.partialNames.add(classified.name);
      return true;
    case "citation":
      work.citation.add(CITATION_TEMPLATE_NAME);
      return true;
    case "unrecognized":
      work.unrecognizedPaths.add(path);
      return true;
    default:
      return false;
  }
}

function foldCitationLanguage(
  files: readonly LegacyTemplateFile[],
): TemplateLanguage {
  return files.every((file) => file.language === "eta") ? "eta" : "liquid";
}

export interface CompileError {
  message: string;
  context?: string;
  at?: EngineFaultSpan;
}

export interface FrontmatterFieldStatus {
  fields: readonly FrontmatterField[];
  inertKeys: readonly string[];
}

export function errorContext(error: unknown): string | undefined {
  return error !== null &&
    typeof error === "object" &&
    "context" in error &&
    typeof error.context === "string"
    ? error.context
    : undefined;
}

interface SettledWaiter {
  resolve: () => void;
}

export type SettleOutcome = "settled" | "timeout" | "init-failed";

const wrapManagedContent = managedRegionTransform(MANAGED_CONTENT_TEMPLATE);

function makeTemplateEngine(options: TemplateEngineOptions) {
  const state = {
    facade: new TemplateFacade({
      transformRender: (name, output) =>
        coreContentIsVaultBacked() ? wrapManagedContent(name, output) : output,
    }),
    closed: false,
    initFailed: false,
    compileErrors: new Map<string, CompileError>(),
    loadedDocumentSources: new Map<string, string>(),
    winners: new Map<string, TemplateWinner>(),
    shadowed: new Map<string, string>(),
    inertEta: new Map<string, string>(),
    pending: emptyTemplateWork(),
    partials: new Map<string, RegisteredPartial>(),
    inertPartials: new Map<string, LiteratureNoteTemplatePartial>(),
    partialNames: new Set<string>(),
    reservedPartialFiles: new Map<string, string>(),
    citation: null as RegisteredCitationTemplate | null,
    unrecognizedFiles: new Set<string>(),
    literatureNoteDocuments: new Map<
      string,
      ReconciledLiteratureNoteTemplate
    >(),
    literatureNoteDocumentErrors: new Map<string, Error>(),
    settledWaiters: new Set<SettledWaiter>(),
    lastFrontmatterFields: null as readonly FrontmatterField[] | null,
    compiledFrontmatterFields: [] as readonly CompiledFrontmatterField[],
    inertFrontmatterKeys: [] as readonly string[],
    flushTimer: null as (() => void) | null,
    settlingTasks: 0,
    folderGeneration: 0,
    loaded: false,
    lastTemplateFolder: "",
    lastAutoTrim: [false, false] as [AutoTrim, AutoTrim],
    app: options.app,
    settings: { current: options.snapshot },
    log: options.log,
    flushRequested: options.flushRequested,
    intakePending: options.intakePending,
    schedule: options.schedule,
    changed: options.changed,
    javascriptTemplatesEnabled:
      options.app.loadLocalStorage(JS_TEMPLATES_STORAGE_KEY) === "1",
  };
  function readCompileErrors(): ReadonlyMap<string, CompileError> {
    return state.compileErrors;
  }
  function getLoadedDocumentSource(path: string): string | undefined {
    return state.loadedDocumentSources.get(path);
  }
  function readShadowedFiles(): ReadonlyMap<string, string> {
    return state.shadowed;
  }
  function readInertEtaFiles(): ReadonlyMap<string, string> {
    return state.inertEta;
  }
  function readJavascriptTemplatesEnabled(): boolean {
    return state.javascriptTemplatesEnabled;
  }
  function readLoaded(): boolean {
    return state.loaded;
  }
  function getUnrecognizedFiles(): readonly string[] {
    coreRequireLoaded("getUnrecognizedFiles");
    return [...state.unrecognizedFiles].sort();
  }
  function getTemplateFileStatuses(): readonly TemplateFileStatus[] {
    coreRequireLoaded("getTemplateFileStatuses");
    return state.settings.current?.["note.template-conversion-pending"]
      ? coreGetTemplateFileStatuses(TEMPLATE_NAMES)
      : [];
  }
  const getCitationTemplateStatus = Effect.fn(
    "Template.core.getCitationTemplateStatus",
  )(function* (): Effect.fn.Return<
    CitationTemplateStatus,
    TemplateFailure,
    Vault
  > {
    yield* attempt(() => coreRequireLoaded("getCitationTemplateStatus"));
    const path = citationPath(coreCurrentTemplateFolder());
    const inertPath = state.inertEta.get(CITATION_TEMPLATE_NAME) ?? null;
    return {
      path,
      customized: (yield* (yield* Vault).getFileByPath(path)) !== null,
      language: state.citation?.language ?? "liquid",
      inertPath,
      compileError:
        state.compileErrors.get(CITATION_TEMPLATE_NAME)?.message ?? null,
    };
  });
  const materializeCitationTemplate = Effect.fn(
    "Template.core.materializeCitationTemplate",
  )(function* (): Effect.fn.Return<TFile, TemplateFailure, Vault> {
    yield* attempt(() => coreRequireLoaded("materializeCitationTemplate"));
    const path = citationPath(coreCurrentTemplateFolder());
    const existing = yield* (yield* Vault).getFileByPath(path);
    if (existing) return existing;
    yield* ensureVaultFolder(coreCurrentTemplateFolder() || "/");
    const file = yield* (yield* Vault).create(path, CITATION_TEMPLATE_SOURCE);
    yield* coreSettle();
    return file;
  });
  const restoreCitationTemplate = Effect.fn(
    "Template.core.restoreCitationTemplate",
  )(function* (): Effect.fn.Return<void, TemplateFailure, Vault | FileManager> {
    yield* attempt(() => coreRequireLoaded("restoreCitationTemplate"));
    const file = yield* (yield* Vault).getFileByPath(
      citationPath(coreCurrentTemplateFolder()),
    );
    if (!file) return;
    yield* (yield* FileManager).trashFile(file);
    yield* coreSettle();
  });
  function coreGetTemplateFileStatuses(
    names: readonly TemplateName[],
  ): readonly TemplateFileStatus[] {
    const folder = coreCurrentTemplateFolder();

    return names.map((name) => {
      const liquidPath = templatePath(folder, name, "liquid");
      const winner = state.winners.get(name) ?? EMBEDDED_DEFAULT_WINNER;

      const shadowed = state.shadowed.get(name);
      const inert = state.inertEta.get(name);
      return {
        name,
        winner,
        editablePath:
          winner.source.kind === "vault" ? winner.source.path : liquidPath,
        shadowedFiles: shadowed ? [shadowed] : [],
        inertFiles: inert ? [inert] : [],
        compileError: state.compileErrors.get(name)?.message ?? null,
      };
    });
  }
  function getLiteratureNoteTemplate(
    reference: string,
  ): ResolvedLiteratureNoteTemplate | undefined {
    coreRequireLoaded("getLiteratureNoteTemplate");
    const error = state.literatureNoteDocumentErrors.get(reference);
    if (error) throw error;
    const entry = state.literatureNoteDocuments.get(reference);
    if (!entry) return undefined;
    return coreResolveLiteratureDocument(entry, reference);
  }
  function prepareLiteratureNoteTemplateSource(
    source: string,
  ): ResolvedLiteratureNoteTemplate {
    coreRequireLoaded("prepareLiteratureNoteTemplateSource");
    const document = state.facade.parseLiteratureNoteTemplate(source);
    return coreResolveLiteratureDocument(
      { document, path: "source override" },
      "source override",
    );
  }
  function coreResolveLiteratureDocument(
    entry: ReconciledLiteratureNoteTemplate,
    reference: string,
  ): ResolvedLiteratureNoteTemplate {
    const { document, path } = entry;
    if (
      (document.manifest.language === "eta" ||
        document.manifest.partials?.some(
          (partial) => partial.language === "eta",
        )) &&
      !state.javascriptTemplatesEnabled
    ) {
      throw new InertTemplateError(m.settings_template_inert_eta({ path }));
    }
    const facade = document.manifest.partials
      ? new TemplateFacade({
          transformRender: managedRegionTransform(MANAGED_CONTENT_TEMPLATE),
        })
      : state.facade;
    for (const partial of document.manifest.partials ?? [])
      facade.define(partial.name, partial.source, partial.language);
    const frontmatter = document.manifest.frontmatter
      ? facade.compileManagedFrontmatterEntries(document.manifest.frontmatter, {
          javascript: state.javascriptTemplatesEnabled,
        })
      : undefined;
    return {
      reference,
      path,
      manifest: document.manifest,
      frontmatter,
      hasManagedBlock: document.managedBlock !== null,
      renderForCreate: <T extends object>(data: T) =>
        coreClassifyRender(
          () => facade.renderLiteratureNoteTemplateForCreate(document, data),
          path,
        ),
      renderForUpdate: <T extends object>(data: T) =>
        coreClassifyRender(
          () => facade.renderLiteratureNoteTemplateForUpdate(document, data),
          path,
        ),
      renderAnnotation: <T extends object>(data: T) =>
        coreClassifyRender(
          () => facade.renderLiteratureNoteTemplateAnnotation(document, data),
          path,
        ),
      renderFilename: <T extends object>(data: T) =>
        toSingleLine(
          coreClassifyRender(
            () => facade.renderLiteratureNoteTemplateFilename(document, data),
            path,
          ),
        ),
    };
  }
  function coreClassifyRender<T>(render: () => T, documentPath?: string): T {
    try {
      return render();
    } catch (error) {
      const failure = classifyRenderFailure(
        error,
        state.compileErrors,
        state.inertEta,
      );
      throw documentPath !== undefined &&
        failure instanceof MissingTemplateError &&
        !(failure instanceof MissingPartialError)
        ? new MissingPartialError(documentPath, failure.templateName, error)
        : failure;
    }
  }
  function renderProfileAnnotation<T extends object>(
    data: T,
    options: { profile: ResolvedProfile },
  ): string {
    const { profile } = options;
    if (profile.settings["note.template-conversion-pending"]) {
      return render("annotation", data);
    }

    if (profile.document) {
      const document = getLiteratureNoteTemplate(profile.document);
      if (!document) {
        throw new ProfileAnnotationError({
          code: "missing-literature-note-template",
          document: profile.document,
          hint: "Restore the document in the template folder or clear the Profile document reference.",
        });
      }
      return document.renderAnnotation(data);
    }
    coreRequireLoaded("renderProfileAnnotation");
    return state.facade.render("annotation", data, {
      source: DEFAULT_TEMPLATES.annotation,
      language: "liquid",
    });
  }
  function getLiteratureNoteTemplateStatuses(): readonly LiteratureNoteTemplateStatus[] {
    coreRequireLoaded("getLiteratureNoteTemplateStatuses");
    const references = new Set([
      ...state.literatureNoteDocuments.keys(),
      ...state.literatureNoteDocumentErrors.keys(),
    ]);
    return [...references].sort().map((reference) => {
      const entry = state.literatureNoteDocuments.get(reference);
      if (entry) {
        return {
          reference,
          path: entry.path,
          validation: {
            state: "valid",
            manifest: entry.document.manifest,
            hasManagedBlock: entry.document.managedBlock !== null,
          },
        };
      }
      const error = state.literatureNoteDocumentErrors.get(reference)!;
      const path = join(coreCurrentTemplateFolder(), reference);
      return {
        reference,
        path,
        validation: {
          state: "invalid",
          ...(error instanceof LiteratureNoteTemplateError &&
          error.manifestId !== undefined
            ? { manifestId: error.manifestId }
            : {}),
          error:
            error instanceof LiteratureNoteTemplateError
              ? {
                  code: error.code,
                  message: error.message,
                  recovery: error.recovery,
                  ...(error.offset === undefined
                    ? {}
                    : { offset: error.offset }),
                  ...(error.manifestPath === undefined
                    ? {}
                    : { manifestPath: error.manifestPath }),
                  cause: error.cause,
                }
              : {
                  code: "unknown",
                  message: error.message,
                  recovery: "Correct the document, then inspect it again.",
                  cause: error.cause,
                },
        },
      };
    });
  }
  function renderLiteratureNoteTemplateSource<T extends object>(
    source: string,
    data: T,
  ): { create: string; update: string | null } {
    const document = prepareLiteratureNoteTemplateSource(source);
    return {
      create: document.renderForCreate(data),
      update: document.renderForUpdate(data),
    };
  }
  const exportLiteratureNotePack = Effect.fn(
    "Template.core.exportLiteratureNotePack",
  )(function* (
    reference: string,
    options: { includeFolders?: boolean } = {},
  ): Effect.fn.Return<string, TemplateFailure, Vault | Workspace> {
    yield* attempt(() => coreRequireLoaded("exportLiteratureNotePack"));
    const reconciled = state.literatureNoteDocuments.get(reference);
    if (!reconciled) {
      return yield* Effect.fail(
        templateFailure(
          new Error(`Literature Note Template '${reference}' is not installed`),
        ),
      );
    }
    const documentFile = yield* (yield* Vault).getFileByPath(reconciled.path);
    if (!documentFile) {
      return yield* Effect.fail(
        templateFailure(
          new Error(`Literature Note Template '${reference}' is unavailable`),
        ),
      );
    }
    return yield* exportLiteratureNotePackSource(
      yield* (yield* Vault).cachedRead(documentFile),
      options,
    );
  });
  const exportLiteratureNotePackSource = Effect.fn(
    "Template.core.exportLiteratureNotePackSource",
  )(function* (
    source: string,
    options: {
      includeFolders?: boolean;
      include?: readonly string[];
      onMissingPartial?: (name: string) => void;
    } = {},
  ): Effect.fn.Return<string, TemplateFailure, Vault | Workspace> {
    yield* attempt(() => coreRequireLoaded("exportLiteratureNotePackSource"));
    const partials = (yield* Effect.forEach(
      [...state.winners.entries()],
      ([name, winner]) =>
        Effect.gen(function* () {
          if (winner.source.kind === "none") return null;
          if (winner.source.kind === "embedded-default") {
            if (!isTemplateName(name)) return null;
            return {
              name,
              language: winner.language,
              source: DEFAULT_TEMPLATES[name],
            } satisfies LiteratureNoteTemplatePartial;
          }
          const file = yield* (yield* Vault).getFileByPath(winner.source.path);
          if (!file) return null;
          return {
            name,
            language: winner.language,
            source: yield* readLiveText(file),
          } satisfies LiteratureNoteTemplatePartial;
        }),
      { concurrency: "unbounded" },
    )).filter((partial) => partial !== null);
    partials.push(...getPartialEntries());
    if (state.citation) {
      partials.push({
        name: CITATION_TEMPLATE_NAME,
        language: state.citation.language,
        source: state.citation.source,
      });
    }
    return yield* attempt(() =>
      formatLiteratureNotePack(source, partials, options),
    );
  });
  const refresh = Effect.fn("Template.core.refresh")(
    function* (): Effect.fn.Return<void, TemplateFailure, Vault> {
      yield* coreRebuildFolder(coreCurrentTemplateFolder());
      yield* coreSettle();
    },
  );
  const waitUntilSettled = Effect.fn("Template.core.waitUntilSettled")(
    function* (
      timeoutMs: number,
    ): Effect.fn.Return<SettleOutcome, never, never> {
      if (timeoutMs <= 0) return "timeout";
      if (state.initFailed) return "init-failed";
      if (state.closed || coreIsSettled()) return "settled";
      return yield* Effect.callback<SettleOutcome>((resume) => {
        const waiter = { resolve: () => resume(Effect.succeed("settled")) };
        state.settledWaiters.add(waiter);
        coreResolveSettledWaiters();
        return Effect.sync(() => {
          state.settledWaiters.delete(waiter);
        });
      }).pipe(
        Effect.timeoutOrElse({
          duration: timeoutMs,
          orElse: () => Effect.succeed("timeout" as const),
        }),
      );
    },
  );
  function readFrontmatterFields(): readonly CompiledFrontmatterField[] {
    if (state.inertFrontmatterKeys.length > 0) {
      throw new InertTemplateError(
        m.notice_frontmatter_js_inert({
          fields: state.inertFrontmatterKeys.join(", "),
        }),
      );
    }
    return state.compiledFrontmatterFields;
  }
  function getFrontmatterFieldStatus(): FrontmatterFieldStatus {
    return {
      fields: state.lastFrontmatterFields ?? [],
      inertKeys: state.inertFrontmatterKeys,
    };
  }
  function evaluateFrontmatterFields(
    fields: readonly FrontmatterField[],
    zt: object,
  ): {
    values: Readonly<Record<string, unknown>>;
    errors: Readonly<Record<string, string>>;
    inertKeys: readonly string[];
  } {
    coreRequireLoaded("evaluateFrontmatterFields");
    const { compiled, inertKeys } = state.facade.compileFrontmatterFields(
      fields,
      { javascript: state.javascriptTemplatesEnabled },
    );
    const errors: Record<string, string> = {};
    const values = evalFrontmatterFields(compiled, zt, (key, error) => {
      errors[key] = error instanceof Error ? error.message : String(error);
    });
    return { values, errors, inertKeys };
  }
  function render<T extends object>(name: string, data: T): string {
    coreRequireLoaded("render");
    const inertPath = state.inertEta.get(name);
    if (inertPath !== undefined) {
      throw new InertTemplateError(
        m.settings_template_inert_eta({ path: inertPath }),
        name,
      );
    }
    const compileError = state.compileErrors.get(name);
    if (compileError !== undefined) {
      throw new TemplateError(
        compileErrorMessage(name, compileError.message),
        name,
      );
    }
    return coreClassifyRender(() => state.facade.render(name, data));
  }
  function renderManagedContent<T extends object>(data: T): string {
    const output = render(MANAGED_CONTENT_TEMPLATE, data);
    return coreContentIsVaultBacked() ? output : formatManagedRegion(output);
  }
  function coreContentIsVaultBacked(): boolean {
    return state.winners.get(MANAGED_CONTENT_TEMPLATE)?.source.kind === "vault";
  }
  function renderCitation(
    refs: readonly CiteRef[],
    variant: CitationVariant,
  ): string {
    return renderCitationData(citekeysToCiteTemplateData(refs, variant));
  }
  function renderCitationData(data: CitationTemplateData): string {
    return inlineCitation(render(CITATION_TEMPLATE_NAME, data));
  }
  function getPartialDocument(name: string): SharedPartialDocument | null {
    coreRequireLoaded("getPartialDocument");
    const registered = state.partials.get(name);
    if (registered)
      return { name, path: registered.path, language: registered.language };
    const path = partialPath(coreCurrentTemplateFolder(), name);
    if (state.inertEta.get(name) === path)
      return { name, path, language: "eta" };
    return !state.partialNames.has(name)
      ? null
      : { name, path, language: "liquid" };
  }
  function getPartialNames(): readonly string[] {
    coreRequireLoaded("getPartialNames");
    return [...state.partialNames].sort();
  }
  function getPartialDocuments(): readonly SharedPartialDocument[] {
    return getPartialNames()
      .map((name) => getPartialDocument(name))
      .filter((document) => document !== null);
  }
  function getPartialEntries(): readonly LiteratureNoteTemplatePartial[] {
    coreRequireLoaded("getPartialEntries");
    return getPartialNames().flatMap((name) => {
      const registered = state.partials.get(name);
      if (registered)
        return [
          { name, language: registered.language, source: registered.source },
        ];
      const inert = state.inertPartials.get(name);
      return inert ? [inert] : [];
    });
  }
  function planPartialUnpack(
    bundled: readonly LiteratureNoteTemplatePartial[],
  ): readonly LiteratureNotePartialUnpack[] {
    coreRequireLoaded("planPartialUnpack");
    const held = new Map<
      string,
      Pick<LiteratureNoteTemplatePartial, "language" | "source"> | null
    >();
    const otherCase = new Set<string>();
    for (const partial of bundled) {
      if (RESERVED_PARTIAL_NAMES.has(partial.name)) {
        held.set(partial.name, partial);
        continue;
      }
      const name = coreHeldPartialName(partial.name);
      if (name !== partial.name) {
        if (name !== undefined) otherCase.add(partial.name);
        continue;
      }
      const registered = state.partials.get(name);
      held.set(
        partial.name,
        registered
          ? { language: registered.language, source: registered.source }
          : null,
      );
    }
    const plan = unpackLiteratureNotePartials(
      bundled,
      held,
      (name) => partialNameRefusal(name, state.partialNames) === null,
    );
    return plan.map((step) =>
      otherCase.has(step.name)
        ? { ...step, verdict: "other-case" as const }
        : step,
    );
  }
  const unpackPartials = Effect.fn("Template.core.unpackPartials")(function* (
    plan: readonly LiteratureNotePartialUnpack[],
    options: { replace?: readonly string[] } = {},
  ): Effect.fn.Return<
    PartialUnpackOutcome,
    TemplateFailure,
    Vault | Workspace
  > {
    yield* attempt(() => coreRequireLoaded("unpackPartials"));
    const replace = new Set(options.replace);
    const folder = coreCurrentTemplateFolder();
    const written: string[] = [];
    const kept: string[] = [];
    const refused: string[] = [];
    const otherCase: string[] = [];
    const dropped: string[] = [];
    for (const step of plan) {
      if (step.verdict === "unchanged") {
        dropped.push(step.name);
        continue;
      }
      if (step.verdict === "other-case") {
        otherCase.push(step.name);
        continue;
      }
      if (partialNameRefusal(step.name, [])) {
        refused.push(step.name);
        continue;
      }
      const declined = step.verdict === "conflict" && !replace.has(step.name);
      if (!declined && (yield* coreWritePartialFile(folder, step)))
        written.push(step.name);
      else kept.push(step.name);
      dropped.push(step.name);
    }
    if (written.length > 0) yield* coreSettle();
    state.log("debug", "Unpacked bundled partials", {
      written,
      kept,
      refused,
      otherCase,
    });
    return { written, kept, dropped, refused, otherCase };
  });
  function coreHeldPartialName(name: string): string | undefined {
    const folded = name.toLowerCase();
    return [...state.partialNames].find(
      (taken) => taken.toLowerCase() === folded,
    );
  }
  const coreWritePartialFile = Effect.fn("Template.core.coreWritePartialFile")(
    function* (
      folder: string,
      step: LiteratureNotePartialUnpack,
    ): Effect.fn.Return<
      boolean,
      | VaultError
      | VaultFolderBlockedError
      | import("@zotlit/obsidian-kit/effect-live-text.ts").LiveTextRewriteFailed,
      Vault | Workspace
    > {
      if (step.verdict === "conflict") {
        const held = coreHeldPartialName(step.name);
        const file =
          held === undefined
            ? null
            : yield* (yield* Vault).getFileByPath(partialPath(folder, held));
        if (file) {
          yield* processLiveText(file, () => step.document);
          return true;
        }
      }
      yield* ensureVaultFolder(folder || "/");
      const created = yield* (yield* Vault)
        .create(partialPath(folder, step.name), step.document)
        .pipe(
          Effect.as(true),
          Effect.catchTag("FileExists", () => Effect.succeed(false)),
        );
      if (!created)
        state.log(
          "debug",
          "A partial document appeared after the unpack plan",
          {
            name: step.name,
          },
        );
      return created;
    },
  );
  function getReservedPartialFiles(): readonly {
    name: string;
    path: string;
  }[] {
    coreRequireLoaded("getReservedPartialFiles");
    return [...state.reservedPartialFiles]
      .map(([name, path]) => ({ name, path }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }
  const createPartial = Effect.fn("Template.core.createPartial")(function* (
    name: string,
    options: { source?: string; language?: TemplateLanguage } = {},
  ): Effect.fn.Return<TFile, TemplateFailure, Vault> {
    yield* attempt(() => coreRequireLoaded("createPartial"));
    const refusal = partialNameRefusal(name, state.partialNames);
    if (refusal)
      return yield* Effect.fail(
        templateFailure(new PartialNameError(name, refusal)),
      );
    const folder = coreCurrentTemplateFolder();
    yield* ensureVaultFolder(folder || "/");
    const source = options.source ?? "";
    const file = yield* (yield* Vault).create(
      partialPath(folder, name),
      options.language === undefined
        ? source
        : formatPlainTemplateDocument(source, options.language),
    );
    yield* coreSettle();
    state.log("debug", "Created a Shared Partial", { name, path: file.path });
    return file;
  });
  const deletePartial = Effect.fn("Template.core.deletePartial")(function* (
    name: string,
  ): Effect.fn.Return<void, TemplateFailure, Vault | FileManager> {
    yield* attempt(() => coreRequireLoaded("deletePartial"));
    const file = yield* (yield* Vault).getFileByPath(
      partialPath(coreCurrentTemplateFolder(), name),
    );
    if (!file) return;
    yield* (yield* FileManager).trashFile(file);
    yield* coreSettle();
  });
  function renderPartialSource<T extends object>(
    source: string,
    data: T,
    options: { name: string },
  ): string {
    coreRequireLoaded("renderPartialSource");
    return coreRenderPlainSource(source, data, {
      name: options.name,
      path: partialPath(coreCurrentTemplateFolder(), options.name),
    });
  }
  function coreRenderPlainSource<T extends object>(
    source: string,
    data: T,
    options: { name: string; path: string },
  ): string {
    const parsed = parsePlainTemplateDocument(source);
    const { language } = parsed.manifest;
    if (language === "eta" && !state.javascriptTemplatesEnabled) {
      throw new InertTemplateError(
        m.settings_template_inert_eta({ path: options.path }),
        options.name,
      );
    }
    return coreClassifyRender(() =>
      state.facade.render(options.name, data, {
        source: parsed.source,
        language,
      }),
    );
  }
  function renderCitationSource(
    source: string,
    data: CitationTemplateData,
  ): string {
    coreRequireLoaded("renderCitationSource");
    return inlineCitation(
      coreRenderPlainSource(source, data, {
        name: CITATION_TEMPLATE_NAME,
        path: citationPath(coreCurrentTemplateFolder()),
      }),
    );
  }
  function renderFilename<T extends object>(data: T): string {
    return toSingleLine(render("filename", data));
  }
  function analyzeRootVariables(name: string): RootVariableUse[] | null {
    coreRequireLoaded("analyzeRootVariables");
    return state.facade.analyzeRootVariables(name);
  }
  const getTemplateSource = Effect.fn("Template.core.getTemplateSource")(
    function* (
      name: TemplateName,
    ): Effect.fn.Return<string, TemplateFailure, Vault> {
      yield* attempt(() => coreRequireLoaded("getTemplateSource"));
      const winner = state.winners.get(name) ?? EMBEDDED_DEFAULT_WINNER;
      if (winner.source.kind === "vault") {
        const file = yield* (yield* Vault).getFileByPath(winner.source.path);
        if (file) return yield* (yield* Vault).cachedRead(file);
      }
      return DEFAULT_TEMPLATES[name];
    },
  );
  function getLegacyLiteratureNoteTemplateFiles(): readonly string[] {
    return coreLegacyLiteratureNoteSlots().flatMap(({ paths }) => paths);
  }
  function coreLegacyLiteratureNoteSlots(): {
    name: TemplateName;
    paths: string[];
  }[] {
    return coreGetTemplateFileStatuses(TEMPLATE_NAMES)
      .filter((status) =>
        LEGACY_LITERATURE_NOTE_TEMPLATE_NAMES.has(status.name),
      )
      .map((status) => ({
        name: status.name,
        paths: [
          ...(status.winner.source.kind === "vault"
            ? [status.winner.source.path]
            : []),
          ...status.shadowedFiles,
          ...status.inertFiles,
        ],
      }))
      .filter(({ paths }) => paths.length > 0);
  }
  function getLegacyTemplateDocuments(): LegacyTemplateDocuments {
    coreRequireLoaded("getLegacyTemplateDocuments");
    const citation: LegacyTemplateFile[] = [];
    const partials: LegacyTemplateFile[] = [];
    for (const name of [...state.winners.keys()].sort()) {
      if (isTemplateName(name)) continue;
      const file = coreLegacyTemplateFile(name);
      if (!file) continue;
      (isLegacyCitationName(name) ? citation : partials).push(file);
    }
    return { citation, partials };
  }
  const convertLegacyTemplateDocuments = Effect.fn(
    "Template.core.convertLegacyTemplateDocuments",
  )(function* (
    refs: readonly CiteRef[],
  ): Effect.fn.Return<
    ConvertedLegacyTemplateDocuments,
    TemplateFailure,
    Vault
  > {
    yield* attempt(() => coreRequireLoaded("convertLegacyTemplateDocuments"));
    const folder = coreCurrentTemplateFolder();
    const { citation, partials } = getLegacyTemplateDocuments();
    const documents: { path: string; source: string }[] = [];
    const trashed: string[] = [];
    const kept: string[] = [];

    if (citation.length > 0) {
      const language = foldCitationLanguage(citation);
      if (language === "eta" && !state.javascriptTemplatesEnabled) {
        return yield* Effect.fail(
          templateFailure(
            new LegacyTemplateConversionError(
              "unsupported-legacy-template",
              "The legacy citation templates are Eta while JavaScript Templates are disabled",
              {
                difference: "inert template",
                recovery:
                  "Enable JavaScript Templates on this device, then retry conversion.",
              },
            ),
          ),
        );
      }
      const legacy: {
        language: TemplateLanguage;
        main?: string;
        alt?: string;
      } = { language };
      const removedNames: string[] = coreLegacyLiteratureNoteSlots().map(
        ({ name }) => name,
      );
      for (const file of citation) {
        if (file.language !== language) {
          kept.push(file.path);
          continue;
        }
        legacy[file.name === "cite" ? "main" : "alt"] =
          yield* coreReadLegacyTemplateFile(file.path);
        trashed.push(file.path, ...file.shadowed);
        removedNames.push(file.name);
      }
      const { source } = yield* attempt(() =>
        state.facade.convertLegacyCitationTemplates(
          legacy,
          {
            main: citekeysToCiteTemplateData(refs, "main"),
            alt: citekeysToCiteTemplateData(refs, "alt"),
          },
          { removedNames },
        ),
      );
      documents.push({
        path: citationPath(folder),
        source: formatPlainTemplateDocument(source, language),
      });
    }

    for (const file of partials) {
      documents.push({
        path: partialPath(folder, file.name),
        source: formatPlainTemplateDocument(
          yield* coreReadLegacyTemplateFile(file.path),
          file.language,
        ),
      });
      trashed.push(file.path, ...file.shadowed);
    }
    state.log("debug", "Planned the legacy Template Document conversion", {
      documents: documents.map(({ path }) => path),
      trashed,
      kept,
    });
    return { documents, trashed, kept };
  });
  function coreLegacyTemplateFile(name: string): LegacyTemplateFile | null {
    const winner = state.winners.get(name);
    if (!winner) return null;
    const shadowed = state.shadowed.get(name);
    if (winner.source.kind === "vault") {
      return {
        name,
        path: winner.source.path,
        language: winner.language,
        inert: false,
        shadowed: shadowed ? [shadowed] : [],
      };
    }
    const inertPath = state.inertEta.get(name);
    if (!inertPath) return null;
    return {
      name,
      path: inertPath,
      language: "eta",
      inert: true,
      shadowed: shadowed ? [shadowed] : [],
    };
  }
  const coreReadLegacyTemplateFile = Effect.fn(
    "Template.core.coreReadLegacyTemplateFile",
  )(function* (path: string): Effect.fn.Return<string, TemplateFailure, Vault> {
    const file = yield* (yield* Vault).getFileByPath(path);
    if (!file) {
      return yield* Effect.fail(
        templateFailure(
          new LegacyTemplateConversionError(
            "unsupported-legacy-template",
            `Legacy template file '${path}' is no longer in the vault`,
            {
              difference: "missing legacy file",
              recovery: "Reload the template folder, then retry conversion.",
            },
          ),
        ),
      );
    }
    return yield* (yield* Vault).cachedRead(file);
  });
  const convertLegacyLiteratureNoteTemplates = Effect.fn(
    "Template.core.convertLegacyLiteratureNoteTemplates",
  )(function* (data: {
    readonly note: object;
    readonly filename: object;
    readonly annotation?: object;
  }): Effect.fn.Return<ConvertedLegacyProfileDocument, TemplateFailure, Vault> {
    yield* attempt(() =>
      coreRequireLoaded("convertLegacyLiteratureNoteTemplates"),
    );
    const statuses = coreGetTemplateFileStatuses(TEMPLATE_NAMES);
    const inert = statuses.find(
      (status) =>
        LEGACY_LITERATURE_NOTE_TEMPLATE_NAMES.has(status.name) &&
        status.winner.source.kind === "none" &&
        status.inertFiles.length > 0,
    );
    if (inert) {
      return yield* Effect.fail(
        templateFailure(
          new LegacyTemplateConversionError(
            "unsupported-legacy-template",
            `Legacy template '${inert.name}' is inert while JavaScript Templates are disabled`,
            {
              difference: "inert template",
              recovery:
                "Enable JavaScript Templates on this device, then retry conversion.",
            },
          ),
        ),
      );
    }
    const source = Effect.fnUntraced(function* (
      name: "filename" | "note" | "content" | "annotation",
    ) {
      const status = statuses.find((candidate) => candidate.name === name)!;
      return {
        source: yield* getTemplateSource(name),
        language: status.winner.language,
      };
    });
    const [note, content, filename] = yield* Effect.all([
      source("note"),
      source("content"),
      source("filename"),
    ]);
    const annotationStatus = statuses.find(
      (candidate) => candidate.name === "annotation",
    )!;
    const annotation =
      annotationStatus.winner.source.kind === "vault"
        ? yield* source("annotation")
        : undefined;
    return {
      ...(yield* attempt(() =>
        state.facade.convertLegacyLiteratureNoteTemplates(
          { note, content, filename, annotation },
          data,
          {
            frontmatter:
              state.settings.current?.["note.frontmatter-fields"] ?? [],
            javascript: state.javascriptTemplatesEnabled,
            managed: coreContentIsVaultBacked(),
          },
        ),
      )),
      legacyFiles: getLegacyLiteratureNoteTemplateFiles(),
    };
  });
  function validateFrontmatterExpr(
    expr: string,
    language: FrontmatterLanguage,
  ): string | null {
    if (language === "javascript" && !state.javascriptTemplatesEnabled) {
      return null;
    }
    return state.facade.validateFrontmatterExpr(expr, language);
  }
  const setJavascriptTemplatesEnabled = Effect.fn(
    "Template.core.setJavascriptTemplatesEnabled",
  )(function* (
    enabled: boolean,
  ): Effect.fn.Return<void, TemplateFailure, Vault> {
    yield* attempt(() => coreRequireLoaded("setJavascriptTemplatesEnabled"));
    if (enabled === state.javascriptTemplatesEnabled) return;

    state.app.saveLocalStorage(JS_TEMPLATES_STORAGE_KEY, enabled ? "1" : null);
    state.javascriptTemplatesEnabled = enabled;
    state.log("info", "JavaScript templates flag changed", { enabled });

    if (state.lastFrontmatterFields) {
      coreCompileFrontmatter(state.lastFrontmatterFields);
    }

    yield* coreRebuildFolder(coreCurrentTemplateFolder());
  });
  const load = Effect.fn("Template.core.load")(function* (): Effect.fn.Return<
    void,
    never,
    Vault | PluginSettings
  > {
    const snapshot = yield* (yield* PluginSettings).current;
    state.settings.current = snapshot;
    state.lastTemplateFolder = normalizeVaultPath(snapshot["template.folder"]);
    state.lastAutoTrim = [
      snapshot["template.auto-trim-leading"],
      snapshot["template.auto-trim-trailing"],
    ];
    state.facade.setAutoTrim(state.lastAutoTrim);
    coreCompileFrontmatter(snapshot["note.frontmatter-fields"]);
    yield* coreRebuildFolder(state.lastTemplateFolder);
    state.loaded = true;
  });
  function failStartup(): void {
    state.initFailed = true;
  }
  function close(): void {
    state.closed = true;
    state.folderGeneration += 1;
    coreCancelFlush();
    for (const bucket of templateWorkBuckets(state.pending)) bucket.clear();
    for (const waiter of state.settledWaiters) waiter.resolve();
    state.settledWaiters.clear();
  }
  const adoptFolderCase = Effect.fn("Template.core.adoptFolderCase")(function* (
    setting: string,
  ): Effect.fn.Return<boolean, never, Vault | PluginSettings> {
    const folder = normalizeVaultPath(setting);
    if (folder === "") return false;
    const held = yield* (yield* Vault).getAbstractFileByPathInsensitive(folder);
    if (!(held instanceof TFolder) || held.path === folder) return false;
    yield* (yield* PluginSettings)
      .update({ "template.folder": held.path })
      .pipe(Effect.orDie);
    state.log("info", "Adopted the vault's case for the template folder", {
      folder: held.path,
    });
    return true;
  });
  const onSettingsChanged = Effect.fn("Template.core.onSettingsChanged")(
    function* (
      settings: Readonly<Settings>,
    ): Effect.fn.Return<void, never, Vault | PluginSettings> {
      if (state.closed) return;
      const folder = normalizeVaultPath(settings["template.folder"]);
      if (
        folder !== state.lastTemplateFolder &&
        (yield* adoptFolderCase(folder))
      )
        return;
      state.settings.current = settings;
      const autoTrim: [AutoTrim, AutoTrim] = [
        settings["template.auto-trim-leading"],
        settings["template.auto-trim-trailing"],
      ];

      const folderChanged = folder !== state.lastTemplateFolder;
      const autoTrimChanged =
        autoTrim[0] !== state.lastAutoTrim[0] ||
        autoTrim[1] !== state.lastAutoTrim[1];

      const frontmatterFields = settings["note.frontmatter-fields"];

      state.lastTemplateFolder = folder;
      state.lastAutoTrim = autoTrim;

      if (frontmatterFields !== state.lastFrontmatterFields) {
        coreCompileFrontmatter(frontmatterFields);
      }

      if (autoTrimChanged) {
        state.facade.setAutoTrim(autoTrim);
        state.log("debug", "Template autoTrim changed", { autoTrim });
      }

      if (folderChanged) {
        yield* coreRebuildFolder(folder);
      }
    },
  );
  const coreRebuildFolder = Effect.fn("Template.core.coreRebuildFolder")(
    function* (folder: string): Effect.fn.Return<void, never, Vault> {
      yield* Effect.acquireUseRelease(
        Effect.sync(() => {
          state.settlingTasks += 1;
        }),
        () =>
          Effect.gen(function* () {
            const generation = ++state.folderGeneration;
            coreCancelFlush();
            for (const bucket of templateWorkBuckets(state.pending))
              bucket.clear();
            state.shadowed.clear();
            state.inertEta.clear();
            state.winners.clear();
            state.partials.clear();
            state.inertPartials.clear();
            state.partialNames.clear();
            state.reservedPartialFiles.clear();
            state.citation = null;
            state.unrecognizedFiles.clear();
            state.facade.reset();
            state.compileErrors.clear();
            state.literatureNoteDocuments.clear();
            state.literatureNoteDocumentErrors.clear();
            state.loadedDocumentSources.clear();

            const root =
              folder === ""
                ? yield* (yield* Vault).getFolderByPath("/")
                : yield* (yield* Vault).getFolderByPath(folder);

            const work = emptyTemplateWork();
            if (root) {
              for (const child of root.children) {
                if (child instanceof TFile)
                  collectTemplatePath(work, child.path);
              }
            } else {
              state.log(
                "debug",
                "Template folder not found; embedded defaults remain",
                {
                  folder,
                },
              );
            }

            for (const name of TEMPLATE_NAMES) {
              if (!work.names.has(name)) coreUseDefault(name);
            }
            work.citation.add(CITATION_TEMPLATE_NAME);

            yield* coreReconcileWork(work, generation);
            yield* Effect.yieldNow;
            if (generation !== state.folderGeneration) return;

            yield* state.changed();
            state.log("debug", "Template folder rebuilt", {
              folder,
              count: work.names.size,
            });
          }),
        () =>
          Effect.sync(() => {
            state.settlingTasks -= 1;
            coreResolveSettledWaiters();
          }),
      );
    },
  );
  const onCreateOrModify = Effect.fn("Template.core.onCreateOrModify")(
    function* (file: TAbstractFile): Effect.fn.Return<void, never, never> {
      if (!(file instanceof TFile)) return;
      yield* coreQueueTemplatePath(file.path);
    },
  );
  const onRename = Effect.fn("Template.core.onRename")(function* (
    file: TAbstractFile,
    oldPathRaw: string,
  ): Effect.fn.Return<void, never, never> {
    yield* coreQueueTemplatePath(oldPathRaw);
    if (file instanceof TFile) yield* coreQueueTemplatePath(file.path);
  });
  const onDelete = Effect.fn("Template.core.onDelete")(function* (
    file: TAbstractFile,
  ): Effect.fn.Return<void, never, never> {
    yield* coreQueueTemplatePath(file.path);
  });
  const coreQueueTemplatePath = Effect.fn(
    "Template.core.coreQueueTemplatePath",
  )(function* (path: string): Effect.fn.Return<void, never, never> {
    const normalized = normalizeVaultPath(path);
    if (
      normalizeVaultPath(dirname(normalized)) !== coreCurrentTemplateFolder()
    ) {
      return;
    }
    if (!collectTemplatePath(state.pending, normalized)) return;
    yield* coreScheduleFlush();
  });
  const coreScheduleFlush = Effect.fn("Template.core.coreScheduleFlush")(
    function* (): Effect.fn.Return<void, never, never> {
      if (state.closed || state.flushTimer !== null) return;
      state.flushTimer = yield* state.schedule(FLUSH_DEBOUNCE_MS, () => {
        state.flushTimer = null;
        state.flushRequested();
      });
    },
  );
  const flushPending = Effect.fn("Template.core.flushPending")(
    function* (): Effect.fn.Return<void, never, Vault> {
      yield* Effect.acquireUseRelease(
        Effect.sync(() => {
          state.settlingTasks += 1;
        }),
        () =>
          Effect.gen(function* () {
            const generation = state.folderGeneration;
            const work = takeTemplateWork(state.pending);
            yield* coreReconcileWork(work, generation);

            if (generation !== state.folderGeneration) return;

            yield* state.changed();
            state.log("debug", "Template flush completed", {
              count: work.names.size,
            });
          }),
        () =>
          Effect.sync(() => {
            state.settlingTasks -= 1;
            coreResolveSettledWaiters();
          }),
      );
    },
  );
  const coreReconcileWork = Effect.fn("Template.core.coreReconcileWork")(
    function* (
      work: TemplateWork,
      generation: number,
    ): Effect.fn.Return<void, never, Vault> {
      for (const path of work.unrecognizedPaths) {
        if (yield* (yield* Vault).getFileByPath(path)) {
          state.unrecognizedFiles.add(path);
        } else {
          state.unrecognizedFiles.delete(path);
        }
      }
      yield* Effect.all([
        ...[...work.names].map((name) => coreReconcileName(name, generation)),
        ...[...work.documentReferences].map((reference) =>
          coreReconcileDocument(reference, generation),
        ),
        ...[...work.partialNames].map((name) =>
          coreReconcilePartial(name, generation),
        ),
        ...(work.citation.size > 0 ? [coreReconcileCitation(generation)] : []),
      ]);
    },
  );
  const coreReconcileName = Effect.fn("Template.core.coreReconcileName")(
    function* (
      name: string,
      generation: number,
    ): Effect.fn.Return<void, never, Vault> {
      if (generation !== state.folderGeneration) return;

      const folder = coreCurrentTemplateFolder();
      const liquidFile = yield* (yield* Vault).getFileByPath(
        templatePath(folder, name, "liquid"),
      );
      const etaFile = yield* (yield* Vault).getFileByPath(
        templatePath(folder, name, "eta"),
      );

      if (state.partials.has(name)) {
        if (!liquidFile && !etaFile) {
          state.winners.delete(name);
          state.shadowed.delete(name);
        }
        return;
      }

      if (liquidFile && etaFile) {
        if (state.shadowed.get(name) !== etaFile.path) {
          state.log("warn", "Eta template shadowed by its Liquid edition", {
            name,
            path: etaFile.path,
          });
        }
        state.shadowed.set(name, etaFile.path);
      } else {
        state.shadowed.delete(name);
      }

      if (!state.javascriptTemplatesEnabled && !liquidFile && etaFile) {
        if (state.inertEta.get(name) !== etaFile.path) {
          state.log(
            "info",
            "Eta template inert while JavaScript templates are disabled",
            { name, path: etaFile.path },
          );
        }
        state.inertEta.set(name, etaFile.path);
        state.winners.set(name, {
          language: "eta",
          source: { kind: "none" },
        });
        state.compileErrors.delete(name);
        state.facade.remove(name, "liquid");
        state.facade.remove(name, "eta");
        return;
      }
      state.inertEta.delete(name);

      const etaCandidate = state.javascriptTemplatesEnabled ? etaFile : null;
      const winner = liquidFile
        ? ({ file: liquidFile, language: "liquid" } as const)
        : etaCandidate
          ? ({ file: etaCandidate, language: "eta" } as const)
          : null;

      if (!winner) {
        state.compileErrors.delete(name);
        coreUseDefault(name);
        return;
      }

      let content: string;
      const read = yield* Effect.result((yield* Vault).cachedRead(winner.file));
      if (Result.isFailure(read)) {
        const error = read.failure;
        if (generation !== state.folderGeneration) return;
        state.log("warn", "Failed to read template file", {
          error,
          path: winner.file.path,
        });
        coreUseDefault(name);
        return;
      }
      content = read.success;

      if (generation !== state.folderGeneration) return;
      state.facade.remove(
        name,
        winner.language === "liquid" ? "eta" : "liquid",
      );
      coreDefineTemplate(name, content, winner.language);
      state.winners.set(name, {
        language: winner.language,
        source: { kind: "vault", path: winner.file.path },
      });
    },
  );
  const coreReconcileDocument = Effect.fn(
    "Template.core.coreReconcileDocument",
  )(function* (
    reference: string,
    generation: number,
  ): Effect.fn.Return<void, never, Vault> {
    if (generation !== state.folderGeneration) return;
    const folder = coreCurrentTemplateFolder();
    const path = folder === "" ? reference : join(folder, reference);
    const file = yield* (yield* Vault).getFileByPath(path);
    if (!file) {
      state.literatureNoteDocuments.delete(reference);
      state.literatureNoteDocumentErrors.delete(reference);
      state.loadedDocumentSources.delete(path);
      return;
    }

    let source: string | undefined;
    yield* Effect.gen(function* () {
      source = yield* (yield* Vault).cachedRead(file);
      if (generation !== state.folderGeneration) return;
      state.loadedDocumentSources.set(path, source);
      const document = yield* attempt(() =>
        state.facade.parseLiteratureNoteTemplate(source!),
      );
      state.literatureNoteDocuments.set(reference, { path, document });
      state.literatureNoteDocumentErrors.delete(reference);
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          if (generation !== state.folderGeneration) return;
          const failure = Error.isError(error)
            ? error
            : new Error(String(error));
          if (source === undefined) state.loadedDocumentSources.delete(path);
          state.literatureNoteDocuments.delete(reference);
          state.literatureNoteDocumentErrors.set(reference, failure);
          state.log(
            "warn",
            "Failed to reconcile Literature Note Template document",
            {
              error: failure,
              path,
            },
          );
        }),
      ),
    );
  });
  const coreReconcilePartial = Effect.fn("Template.core.coreReconcilePartial")(
    function* (
      name: string,
      generation: number,
    ): Effect.fn.Return<void, never, Vault> {
      if (generation !== state.folderGeneration) return;

      const path = partialPath(coreCurrentTemplateFolder(), name);
      const file = yield* (yield* Vault).getFileByPath(path);

      if (RESERVED_PARTIAL_NAMES.has(name)) {
        if (file) {
          state.log("debug", "Partial file claims a reserved template name", {
            name,
            path,
          });
          state.reservedPartialFiles.set(name, path);
          const read = yield* Effect.result((yield* Vault).cachedRead(file));
          if (Result.isFailure(read)) {
            const error = read.failure;
            if (generation !== state.folderGeneration) return;
            state.loadedDocumentSources.delete(path);
            state.log("warn", "Failed to read reserved partial file", {
              error,
              path,
            });
            return;
          }
          const source = read.success;
          if (generation !== state.folderGeneration) return;
          state.loadedDocumentSources.set(path, source);
        } else {
          state.reservedPartialFiles.delete(name);
          state.loadedDocumentSources.delete(path);
        }
        return;
      }

      if (!file) {
        state.partialNames.delete(name);
        state.loadedDocumentSources.delete(path);
        coreRemovePartial(name);
        return;
      }
      state.partialNames.add(name);

      let source: string;
      const read = yield* Effect.result((yield* Vault).cachedRead(file));
      if (Result.isFailure(read)) {
        const error = read.failure;
        if (generation !== state.folderGeneration) return;
        state.log("warn", "Failed to read partial file", { error, path });
        state.loadedDocumentSources.delete(path);
        coreRemovePartial(name);
        state.compileErrors.set(name, { message: errorMessage(error) });
        return;
      }
      source = read.success;

      if (generation !== state.folderGeneration) return;

      state.loadedDocumentSources.set(path, source);
      const parsedResult = yield* Effect.result(
        attempt(() => parsePlainTemplateDocument(source)),
      );
      if (Result.isFailure(parsedResult)) {
        const error = parsedResult.failure;
        coreRemovePartial(name);
        state.compileErrors.set(name, { message: errorMessage(error) });
        state.log("warn", "Failed to parse partial document", { error, path });
        return;
      }
      const parsed = parsedResult.success;

      const { language } = parsed.manifest;
      if (language === "eta" && !state.javascriptTemplatesEnabled) {
        if (state.inertEta.get(name) !== path) {
          state.log(
            "debug",
            "Eta partial inert while JavaScript templates are disabled",
            {
              name,
              path,
            },
          );
        }
        coreRemovePartial(name);
        state.inertEta.set(name, path);
        state.inertPartials.set(name, {
          name,
          language,
          source: parsed.source,
        });
        return;
      }

      coreRemovePartial(name);
      state.partials.set(name, { path, language, source: parsed.source });
      coreDefineTemplate(name, parsed.source, language);
    },
  );
  const coreReconcileCitation = Effect.fn(
    "Template.core.coreReconcileCitation",
  )(function* (generation: number): Effect.fn.Return<void, never, Vault> {
    if (generation !== state.folderGeneration) return;

    const name = CITATION_TEMPLATE_NAME;
    const path = citationPath(coreCurrentTemplateFolder());
    const file = yield* (yield* Vault).getFileByPath(path);
    if (!file) {
      coreUseBuiltInCitation();
      state.loadedDocumentSources.delete(path);
      return;
    }

    let source: string;
    const read = yield* Effect.result((yield* Vault).cachedRead(file));
    if (Result.isFailure(read)) {
      const error = read.failure;
      if (generation !== state.folderGeneration) return;
      state.log("warn", "Failed to read the Citation Template", {
        error,
        path,
      });
      state.loadedDocumentSources.delete(path);
      coreUseBuiltInCitation();
      state.compileErrors.set(name, { message: errorMessage(error) });
      return;
    }
    source = read.success;

    if (generation !== state.folderGeneration) return;

    state.loadedDocumentSources.set(path, source);
    const parsedResult = yield* Effect.result(
      attempt(() => parsePlainTemplateDocument(source)),
    );
    if (Result.isFailure(parsedResult)) {
      const error = parsedResult.failure;
      coreUnregisterCitation();
      state.compileErrors.set(name, { message: errorMessage(error) });
      state.log("warn", "Failed to parse the Citation Template", {
        error,
        path,
      });
      return;
    }
    const parsed = parsedResult.success;

    const { language } = parsed.manifest;
    if (language === "eta" && !state.javascriptTemplatesEnabled) {
      if (state.inertEta.get(name) !== path) {
        state.log(
          "debug",
          "Citation Template inert while JavaScript templates are disabled",
          { path },
        );
      }
      coreUnregisterCitation();
      state.inertEta.set(name, path);
      return;
    }

    coreRegisterCitation({ path, language, source: parsed.source });
  });
  function coreUseBuiltInCitation(): void {
    coreRegisterCitation({
      path: null,
      language: "liquid",
      source: CITATION_TEMPLATE_SOURCE,
    });
  }
  function coreRegisterCitation(citation: RegisteredCitationTemplate): void {
    const previous = state.citation;
    coreUnregisterCitation();
    state.citation = citation;
    coreDefineTemplate(
      CITATION_TEMPLATE_NAME,
      citation.source,
      citation.language,
    );
    if (
      previous?.path !== citation.path ||
      previous.language !== citation.language
    ) {
      state.log("debug", "Citation Template resolved", {
        selected: citation.path === null ? "built-in" : "vault",
        path: citation.path,
        language: citation.language,
      });
    }
  }
  function coreUnregisterCitation(): void {
    state.citation = null;
    coreUnregisterTemplate(CITATION_TEMPLATE_NAME);
  }
  function coreRemovePartial(name: string): void {
    state.partials.delete(name);
    state.inertPartials.delete(name);
    coreUnregisterTemplate(name);
  }
  function coreUnregisterTemplate(name: string): void {
    state.compileErrors.delete(name);
    state.inertEta.delete(name);
    state.facade.remove(name, "liquid");
    state.facade.remove(name, "eta");
  }
  function coreDefineTemplate(
    name: string,
    content: string,
    language: TemplateLanguage,
  ): void {
    try {
      state.facade.define(name, content, language);
      state.compileErrors.delete(name);
    } catch (error) {
      const at = engineFaultSpan(error, content);
      state.compileErrors.set(name, {
        message: errorMessage(error),
        context: errorContext(error),
        ...(at === undefined ? {} : { at }),
      });
      state.log("warn", "Failed to compile vault template", { error, name });
      state.facade.remove(name, language);
    }
  }
  function coreUseDefault(name: string): void {
    state.facade.remove(name, "eta");
    if (!isTemplateName(name)) {
      state.facade.remove(name, "liquid");
      state.winners.delete(name);
      return;
    }
    state.winners.set(name, EMBEDDED_DEFAULT_WINNER);
    try {
      state.facade.define(name, DEFAULT_TEMPLATES[name], "liquid");
      state.compileErrors.delete(name);
    } catch (error) {
      const at = engineFaultSpan(error, DEFAULT_TEMPLATES[name]);
      state.compileErrors.set(name, {
        message: errorMessage(error),
        context: errorContext(error),
        ...(at === undefined ? {} : { at }),
      });
      state.log("error", "Built-in default template failed to compile", {
        error,
        name,
      });
      state.facade.remove(name, "liquid");
    }
  }
  const coreSettle = Effect.fn("Template.core.coreSettle")(
    function* (): Effect.fn.Return<void, TemplateFailure, never> {
      if ((yield* waitUntilSettled(SETTLE_TIMEOUT_MS)) !== "settled") {
        return yield* Effect.fail(
          templateFailure(
            new Error("The template folder did not finish scanning"),
          ),
        );
      }
    },
  );
  function coreCurrentTemplateFolder(): string {
    return normalizeVaultPath(
      state.settings.current?.["template.folder"] ?? state.lastTemplateFolder,
    );
  }
  function coreCompileFrontmatter(fields: readonly FrontmatterField[]): void {
    state.lastFrontmatterFields = fields;
    const filtered = fields.filter((field) => !RESERVED_KEYS.has(field.key));
    const { compiled, inertKeys } = state.facade.compileFrontmatterFields(
      filtered,
      { javascript: state.javascriptTemplatesEnabled },
    );
    state.compiledFrontmatterFields = compiled;
    state.inertFrontmatterKeys = inertKeys;

    if (inertKeys.length > 0) {
      state.log("info", "Skipping inert frontmatter fields", {
        keys: inertKeys,
      });
    }
  }
  function coreCancelFlush(): void {
    if (state.flushTimer !== null) {
      state.flushTimer();
      state.flushTimer = null;
    }
    coreResolveSettledWaiters();
  }
  function intakeHandled(): void {
    coreResolveSettledWaiters();
  }
  function coreIsSettled(): boolean {
    return (
      state.intakePending() === 0 &&
      state.settlingTasks === 0 &&
      state.flushTimer === null &&
      isTemplateWorkEmpty(state.pending)
    );
  }
  function coreResolveSettledWaiters(): void {
    if (!coreIsSettled()) return;
    for (const waiter of state.settledWaiters) {
      waiter.resolve();
    }
    state.settledWaiters.clear();
  }
  function coreRequireLoaded(method: string): void {
    if (!state.loaded) {
      throw new Error(`TemplateService.${method}(): service is not ready`);
    }
  }
  return {
    get compileErrors() {
      return readCompileErrors();
    },
    getLoadedDocumentSource,
    get shadowedFiles() {
      return readShadowedFiles();
    },
    get inertEtaFiles() {
      return readInertEtaFiles();
    },
    get javascriptTemplatesEnabled() {
      return readJavascriptTemplatesEnabled();
    },
    get loaded() {
      return readLoaded();
    },
    getUnrecognizedFiles,
    getTemplateFileStatuses,
    getCitationTemplateStatus,
    materializeCitationTemplate,
    restoreCitationTemplate,
    getLiteratureNoteTemplate,
    prepareLiteratureNoteTemplateSource,
    renderProfileAnnotation,
    getLiteratureNoteTemplateStatuses,
    renderLiteratureNoteTemplateSource,
    exportLiteratureNotePack,
    exportLiteratureNotePackSource,
    refresh,
    waitUntilSettled,
    get frontmatterFields() {
      return readFrontmatterFields();
    },
    getFrontmatterFieldStatus,
    evaluateFrontmatterFields,
    render,
    renderManagedContent,
    renderCitation,
    renderCitationData,
    getPartialDocument,
    getPartialNames,
    getPartialDocuments,
    getPartialEntries,
    planPartialUnpack,
    unpackPartials,
    getReservedPartialFiles,
    createPartial,
    deletePartial,
    renderPartialSource,
    renderCitationSource,
    renderFilename,
    analyzeRootVariables,
    getTemplateSource,
    getLegacyLiteratureNoteTemplateFiles,
    getLegacyTemplateDocuments,
    convertLegacyTemplateDocuments,
    convertLegacyLiteratureNoteTemplates,
    validateFrontmatterExpr,
    setJavascriptTemplatesEnabled,
    load,
    failStartup,
    close,
    onSettingsChanged,
    adoptFolderCase,
    onCreateOrModify,
    onRename,
    onDelete,
    flushPending,
    intakeHandled,
  };
}
type TemplateEngine = ReturnType<typeof makeTemplateEngine>;

function classifyRenderFailure(
  error: unknown,
  compileErrors: ReadonlyMap<string, CompileError>,
  inertTemplates: ReadonlyMap<string, string>,
): Error {
  const chain = errorChain(error);
  const inertFailure = chain.find(
    (candidate) => candidate instanceof InertTemplateError,
  );
  if (inertFailure) return inertFailure;

  const namedFailure = chain.find(
    (candidate): candidate is TemplateError =>
      candidate instanceof TemplateError,
  );
  if (!namedFailure) {
    return Error.isError(error) ? error : new Error(errorMessage(error));
  }

  const name = namedFailure.templateName;
  const inertPath = inertTemplates.get(name);
  if (inertPath !== undefined) {
    return new InertTemplateError(
      m.settings_template_inert_eta({ path: inertPath }),
      name,
      { cause: error },
    );
  }

  const compileError = compileErrors.get(name);
  if (compileError !== undefined) {
    return new TemplateError(
      compileErrorMessage(name, compileError.message),
      name,
      { cause: error },
    );
  }
  return namedFailure;
}

function compileErrorMessage(name: string, detail: string): string {
  return `Template '${name}' has a compile error:\n${detail}`;
}

function errorChain(error: unknown): readonly Error[] {
  const errors: Error[] = [];
  const pending = [error];
  const seen = new Set<unknown>();

  while (pending.length > 0) {
    const candidate = pending.shift();
    if (!Error.isError(candidate) || seen.has(candidate)) continue;
    seen.add(candidate);
    errors.push(candidate);
    pending.push(candidate.cause);
    if ("originalError" in candidate) {
      pending.push(candidate.originalError);
    }
    if ("errors" in candidate && Array.isArray(candidate.errors)) {
      pending.push(...(candidate.errors as unknown[]));
    }
  }
  return errors;
}

function errorMessage(error: unknown): string {
  return Error.isError(error) ? error.message : String(error);
}

function toSingleLine(rendered: string): string {
  return rendered.trim().replaceAll(/\s*\n\s*/g, "");
}

export type TemplateStatus = {
  readonly compileErrors: ReadonlyMap<string, CompileError>;
} & (
  | { readonly state: "loading" | "loaded" }
  | {
      readonly state: "init-failed";
      readonly cause: Cause.Cause<never>;
    }
);

export type TemplateFailure =
  | TemplateError
  | LegacyTemplateConversionError
  | LiteratureNoteTemplateError
  | PlainTemplateDocumentError
  | LiteratureNotePackError
  | ProfileAnnotationError
  | InertTemplateError
  | PartialNameError
  | TemplateOperationError
  | TemplateRenderError
  | VaultError
  | FileExists
  | VaultFolderBlockedError
  | import("@zotlit/obsidian-kit/effect-live-text.ts").LiveTextRewriteFailed;

export class Template extends Context.Service<
  Template,
  {
    readonly status: Effect.Effect<TemplateStatus>;
    readonly changes: Stream.Stream<TemplateStatus>;
    readonly compileEvents: Stream.Stream<void>;
    readonly compileErrors: Effect.Effect<
      ReadonlyMap<string, CompileError>,
      TemplateFailure
    >;
    getLoadedDocumentSource(
      path: string,
    ): Effect.Effect<string | undefined, TemplateFailure>;
    readonly shadowedFiles: Effect.Effect<
      ReadonlyMap<string, string>,
      TemplateFailure
    >;
    readonly inertEtaFiles: Effect.Effect<
      ReadonlyMap<string, string>,
      TemplateFailure
    >;
    readonly javascriptTemplatesEnabled: Effect.Effect<
      boolean,
      TemplateFailure
    >;
    readonly loaded: Effect.Effect<boolean, TemplateFailure>;
    readonly getUnrecognizedFiles: Effect.Effect<
      readonly string[],
      TemplateFailure
    >;
    readonly getTemplateFileStatuses: Effect.Effect<
      readonly TemplateFileStatus[],
      TemplateFailure
    >;
    readonly getCitationTemplateStatus: Effect.Effect<
      CitationTemplateStatus,
      TemplateFailure
    >;
    readonly materializeCitationTemplate: Effect.Effect<TFile, TemplateFailure>;
    readonly restoreCitationTemplate: Effect.Effect<void, TemplateFailure>;
    getLiteratureNoteTemplate(
      reference: string,
    ): Effect.Effect<
      ResolvedLiteratureNoteTemplate | undefined,
      TemplateFailure
    >;
    prepareLiteratureNoteTemplateSource(
      source: string,
    ): Effect.Effect<ResolvedLiteratureNoteTemplate, TemplateFailure>;
    renderProfileAnnotation<T extends object>(
      data: T,
      options: { profile: ResolvedProfile },
    ): Effect.Effect<string, TemplateFailure>;
    readonly getLiteratureNoteTemplateStatuses: Effect.Effect<
      readonly LiteratureNoteTemplateStatus[],
      TemplateFailure
    >;
    renderLiteratureNoteTemplateSource<T extends object>(
      source: string,
      data: T,
    ): Effect.Effect<
      { create: string; update: string | null },
      TemplateFailure
    >;
    exportLiteratureNotePack(
      reference: string,
      options?: { includeFolders?: boolean },
    ): Effect.Effect<string, TemplateFailure>;
    exportLiteratureNotePackSource(
      source: string,
      options?: {
        includeFolders?: boolean;
        include?: readonly string[];
        onMissingPartial?: (name: string) => void;
      },
    ): Effect.Effect<string, TemplateFailure>;
    readonly refresh: Effect.Effect<void, TemplateFailure>;
    waitUntilSettled(timeoutMs: number): Effect.Effect<SettleOutcome>;
    readonly frontmatterFields: Effect.Effect<
      readonly CompiledFrontmatterField[],
      TemplateFailure
    >;
    readonly getFrontmatterFieldStatus: Effect.Effect<
      FrontmatterFieldStatus,
      TemplateFailure
    >;
    evaluateFrontmatterFields(
      fields: readonly FrontmatterField[],
      zt: object,
    ): Effect.Effect<
      {
        values: Readonly<Record<string, unknown>>;
        errors: Readonly<Record<string, string>>;
        inertKeys: readonly string[];
      },
      TemplateFailure
    >;
    render<T extends object>(
      name: string,
      data: T,
    ): Effect.Effect<string, TemplateFailure>;
    renderManagedContent<T extends object>(
      data: T,
    ): Effect.Effect<string, TemplateFailure>;
    renderCitation(
      refs: readonly CiteRef[],
      variant: CitationVariant,
    ): Effect.Effect<string, TemplateFailure>;
    renderCitationData(
      data: CitationTemplateData,
    ): Effect.Effect<string, TemplateFailure>;
    getPartialDocument(
      name: string,
    ): Effect.Effect<SharedPartialDocument | null, TemplateFailure>;
    readonly getPartialNames: Effect.Effect<readonly string[], TemplateFailure>;
    readonly getPartialDocuments: Effect.Effect<
      readonly SharedPartialDocument[],
      TemplateFailure
    >;
    readonly getPartialEntries: Effect.Effect<
      readonly LiteratureNoteTemplatePartial[],
      TemplateFailure
    >;
    planPartialUnpack(
      bundled: readonly LiteratureNoteTemplatePartial[],
    ): Effect.Effect<readonly LiteratureNotePartialUnpack[], TemplateFailure>;
    unpackPartials(
      plan: readonly LiteratureNotePartialUnpack[],
      options?: { replace?: readonly string[] },
    ): Effect.Effect<PartialUnpackOutcome, TemplateFailure>;
    readonly getReservedPartialFiles: Effect.Effect<
      readonly { name: string; path: string }[],
      TemplateFailure
    >;
    createPartial(
      name: string,
      options?: { source?: string; language?: TemplateLanguage },
    ): Effect.Effect<TFile, TemplateFailure>;
    deletePartial(name: string): Effect.Effect<void, TemplateFailure>;
    renderPartialSource<T extends object>(
      source: string,
      data: T,
      options: { name: string },
    ): Effect.Effect<string, TemplateFailure>;
    renderCitationSource(
      source: string,
      data: CitationTemplateData,
    ): Effect.Effect<string, TemplateFailure>;
    renderFilename<T extends object>(
      data: T,
    ): Effect.Effect<string, TemplateFailure>;
    analyzeRootVariables(
      name: string,
    ): Effect.Effect<RootVariableUse[] | null, TemplateFailure>;
    getTemplateSource(
      name: TemplateName,
    ): Effect.Effect<string, TemplateFailure>;
    readonly getLegacyLiteratureNoteTemplateFiles: Effect.Effect<
      readonly string[],
      TemplateFailure
    >;
    readonly getLegacyTemplateDocuments: Effect.Effect<
      LegacyTemplateDocuments,
      TemplateFailure
    >;
    convertLegacyTemplateDocuments(
      refs: readonly CiteRef[],
    ): Effect.Effect<ConvertedLegacyTemplateDocuments, TemplateFailure>;
    convertLegacyLiteratureNoteTemplates(data: {
      readonly note: object;
      readonly filename: object;
      readonly annotation?: object;
    }): Effect.Effect<ConvertedLegacyProfileDocument, TemplateFailure>;
    validateFrontmatterExpr(
      expr: string,
      language: FrontmatterLanguage,
    ): Effect.Effect<string | null, TemplateFailure>;
    setJavascriptTemplatesEnabled(
      enabled: boolean,
    ): Effect.Effect<void, TemplateFailure>;
  }
>()("zotlit/template/Template") {}

type TemplateCoreOperations = Pick<
  TemplateEngine,
  | "compileErrors"
  | "getLoadedDocumentSource"
  | "shadowedFiles"
  | "inertEtaFiles"
  | "javascriptTemplatesEnabled"
  | "loaded"
  | "getUnrecognizedFiles"
  | "getTemplateFileStatuses"
  | "getCitationTemplateStatus"
  | "materializeCitationTemplate"
  | "restoreCitationTemplate"
  | "getLiteratureNoteTemplate"
  | "prepareLiteratureNoteTemplateSource"
  | "renderProfileAnnotation"
  | "getLiteratureNoteTemplateStatuses"
  | "renderLiteratureNoteTemplateSource"
  | "exportLiteratureNotePack"
  | "exportLiteratureNotePackSource"
  | "refresh"
  | "waitUntilSettled"
  | "frontmatterFields"
  | "getFrontmatterFieldStatus"
  | "evaluateFrontmatterFields"
  | "render"
  | "renderManagedContent"
  | "renderCitation"
  | "renderCitationData"
  | "getPartialDocument"
  | "getPartialNames"
  | "getPartialDocuments"
  | "getPartialEntries"
  | "planPartialUnpack"
  | "unpackPartials"
  | "getReservedPartialFiles"
  | "createPartial"
  | "deletePartial"
  | "renderPartialSource"
  | "renderCitationSource"
  | "renderFilename"
  | "analyzeRootVariables"
  | "getTemplateSource"
  | "getLegacyLiteratureNoteTemplateFiles"
  | "getLegacyTemplateDocuments"
  | "convertLegacyTemplateDocuments"
  | "convertLegacyLiteratureNoteTemplates"
  | "validateFrontmatterExpr"
  | "setJavascriptTemplatesEnabled"
>;

export type TemplateOperations = {
  [K in keyof TemplateCoreOperations]: TemplateCoreOperations[K] extends (
    ...args: infer Args
  ) => Effect.Effect<infer A, infer _E, infer _R>
    ? (...args: Args) => Promise<A>
    : TemplateCoreOperations[K];
};

export const layerTemplate = Layer.effect(
  Template,
  Effect.gen(function* () {
    const app = yield* ObsidianApp;
    const vault = yield* Vault;
    const settings = yield* PluginSettings;
    const scope = yield* Scope.fork(yield* Scope.Scope);
    const context = yield* Effect.context<
      Vault | FileManager | Workspace | PluginSettings
    >();
    const provide = <A, E>(
      effect: Effect.Effect<
        A,
        E,
        Vault | FileManager | Workspace | PluginSettings
      >,
    ) => Effect.provideContext(effect, context);
    const status = yield* SubscriptionRef.make<TemplateStatus>({
      state: "loading",
      compileErrors: new Map(),
    });
    const compileEvents = yield* PubSub.unbounded<void>();
    yield* Effect.addFinalizer(() => PubSub.shutdown(compileEvents));
    const logs = yield* obsidianEvents<{
      log: [
        "debug" | "info" | "warn" | "error",
        string,
        Record<string, unknown>?,
      ];
    }>();
    yield* logs
      .consume(({ args: [level, message, fields] }) => {
        const log = {
          debug: Effect.logDebug,
          info: Effect.logInfo,
          warn: Effect.logWarning,
          error: Effect.logError,
        }[level];
        return log(message).pipe(
          Effect.annotateLogs(fields ?? {}),
          withLogCategory("template"),
        );
      })
      .pipe(Effect.forkScoped({ startImmediately: true }));
    const intake = yield* obsidianEvents<{ vault: [VaultEvent]; flush: [] }>();
    const engine = makeTemplateEngine({
      app,
      snapshot: yield* settings.current,
      changed: () =>
        publishStatus().pipe(
          Effect.andThen(PubSub.publish(compileEvents, undefined)),
          Effect.asVoid,
        ),
      flushRequested: intake.callback("flush"),
      intakePending: () => intake.pending,
      schedule: Effect.fnUntraced(function* (millis, task) {
        const fiber = yield* Effect.sleep(millis).pipe(
          Effect.andThen(Effect.sync(task)),
          Effect.forkIn(scope, { startImmediately: true }),
        );
        return () => fiber.interruptUnsafe();
      }),
      log: logs.callback("log"),
    });
    const publishStatus = () =>
      SubscriptionRef.update(status, (previous) => ({
        ...(previous.state === "init-failed"
          ? previous
          : {
              state: engine.loaded ? ("loaded" as const) : ("loading" as const),
            }),
        compileErrors: new Map(engine.compileErrors),
      }));
    const report = (message: string) => (cause: unknown) =>
      Effect.logWarning(message).pipe(
        Effect.annotateLogs({ cause }),
        withLogCategory("template"),
      );
    yield* intake
      .consume((event) =>
        Effect.gen(function* () {
          switch (event.type) {
            case "vault": {
              const [change] = event.args;
              switch (change._tag) {
                case "create":
                case "modify":
                  yield* provide(engine.onCreateOrModify(change.file));
                  break;
                case "rename":
                  yield* provide(engine.onRename(change.file, change.oldPath));
                  break;
                case "delete":
                  yield* provide(engine.onDelete(change.file));
                  break;
              }
              break;
            }
            case "flush":
              yield* provide(engine.flushPending());
              break;
          }
        }).pipe(Effect.ensuring(Effect.sync(() => engine.intakeHandled()))),
      )
      .pipe(Effect.forkScoped({ startImmediately: true }));
    yield* Effect.gen(function* () {
      yield* forkEach(vault.changes, intake.callback("vault"));
      yield* provide(engine.load());
      yield* publishStatus();
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.sync(() => engine.failStartup()).pipe(
          Effect.andThen(
            SubscriptionRef.set(status, {
              state: "init-failed",
              cause,
              compileErrors: new Map(engine.compileErrors),
            }),
          ),
          Effect.andThen(report("Template startup failed")(cause)),
        ),
      ),
    );
    yield* Stream.runForEach(settings.changes, (snapshot) =>
      provide(engine.onSettingsChanged(snapshot)).pipe(
        Effect.catchCause(report("Template settings update failed")),
        Effect.forkIn(scope, { startImmediately: true }),
      ),
    ).pipe(Effect.forkScoped({ startImmediately: true }));
    yield* (yield* Workspace).layoutReady.pipe(
      Effect.andThen(settings.current),
      Effect.flatMap((current) =>
        provide(engine.adoptFolderCase(current["template.folder"])),
      ),
      Effect.catchCause(report("Template folder case adoption failed")),
      Effect.forkScoped({ startImmediately: true }),
    );
    let closed = false;
    const owned = <A, E>(
      effect: Effect.Effect<A, E>,
      uninterruptible = false,
    ) =>
      closed
        ? Effect.interrupt
        : Effect.forkIn(effect, scope, {
            startImmediately: true,
            uninterruptible,
          }).pipe(Effect.flatMap((fiber) => Fiber.join(fiber)));
    const write = <A, E>(effect: Effect.Effect<A, E>) => owned(effect, true);
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        closed = true;
        engine.close();
      }).pipe(Effect.andThen(PubSub.shutdown(status.pubsub))),
    );
    return Template.of({
      status: SubscriptionRef.get(status),
      changes: SubscriptionRef.changes(status),
      compileEvents: Stream.fromPubSub(compileEvents),
      compileErrors: attempt(() => engine.compileErrors),
      getLoadedDocumentSource: Effect.fn("Template.getLoadedDocumentSource")(
        function* (path: string) {
          return yield* attempt(() => engine.getLoadedDocumentSource(path));
        },
      ),
      shadowedFiles: attempt(() => engine.shadowedFiles),
      inertEtaFiles: attempt(() => engine.inertEtaFiles),
      javascriptTemplatesEnabled: attempt(
        () => engine.javascriptTemplatesEnabled,
      ),
      loaded: attempt(() => engine.loaded),
      getUnrecognizedFiles: attempt(() => engine.getUnrecognizedFiles()).pipe(
        Effect.withSpan("Template.getUnrecognizedFiles"),
      ),
      getTemplateFileStatuses: attempt(() =>
        engine.getTemplateFileStatuses(),
      ).pipe(Effect.withSpan("Template.getTemplateFileStatuses")),
      getCitationTemplateStatus: provide(
        engine.getCitationTemplateStatus(),
      ).pipe(Effect.withSpan("Template.getCitationTemplateStatus")),
      materializeCitationTemplate: Effect.suspend(() =>
        write(
          provide(engine.materializeCitationTemplate()).pipe(
            Effect.uninterruptible,
          ),
        ),
      ).pipe(Effect.withSpan("Template.materializeCitationTemplate")),
      restoreCitationTemplate: Effect.suspend(() =>
        write(
          provide(engine.restoreCitationTemplate()).pipe(
            Effect.uninterruptible,
          ),
        ),
      ).pipe(Effect.withSpan("Template.restoreCitationTemplate")),
      getLiteratureNoteTemplate: Effect.fn(
        "Template.getLiteratureNoteTemplate",
      )(function* (reference: string) {
        return yield* attempt(() =>
          engine.getLiteratureNoteTemplate(reference),
        );
      }),
      prepareLiteratureNoteTemplateSource: Effect.fn(
        "Template.prepareLiteratureNoteTemplateSource",
      )(function* (source: string) {
        return yield* attempt(() =>
          engine.prepareLiteratureNoteTemplateSource(source),
        );
      }),
      renderProfileAnnotation: Effect.fn("Template.renderProfileAnnotation")(
        function* <T extends object>(
          data: T,
          options: { profile: ResolvedProfile },
        ) {
          return yield* attemptRender(() =>
            engine.renderProfileAnnotation(data, options),
          );
        },
      ),
      getLiteratureNoteTemplateStatuses: attempt(() =>
        engine.getLiteratureNoteTemplateStatuses(),
      ).pipe(Effect.withSpan("Template.getLiteratureNoteTemplateStatuses")),
      renderLiteratureNoteTemplateSource: Effect.fn(
        "Template.renderLiteratureNoteTemplateSource",
      )(function* <T extends object>(source: string, data: T) {
        return yield* attemptRender(() =>
          engine.renderLiteratureNoteTemplateSource(source, data),
        );
      }),
      exportLiteratureNotePack: Effect.fn("Template.exportLiteratureNotePack")(
        function* (
          reference: string,
          options: { includeFolders?: boolean } = {},
        ) {
          return yield* owned(
            provide(engine.exportLiteratureNotePack(reference, options)),
          );
        },
      ),
      exportLiteratureNotePackSource: Effect.fn(
        "Template.exportLiteratureNotePackSource",
      )(function* (
        source: string,
        options: {
          includeFolders?: boolean;
          include?: readonly string[];
          onMissingPartial?: (name: string) => void;
        } = {},
      ) {
        return yield* owned(
          provide(engine.exportLiteratureNotePackSource(source, options)),
        );
      }),
      refresh: Effect.suspend(() => owned(provide(engine.refresh()))).pipe(
        Effect.withSpan("Template.refresh"),
      ),
      waitUntilSettled: Effect.fn("Template.waitUntilSettled")(function* (
        timeoutMs: number,
      ) {
        return yield* owned(provide(engine.waitUntilSettled(timeoutMs)));
      }),
      frontmatterFields: attempt(() => engine.frontmatterFields),
      getFrontmatterFieldStatus: attempt(() =>
        engine.getFrontmatterFieldStatus(),
      ).pipe(Effect.withSpan("Template.getFrontmatterFieldStatus")),
      evaluateFrontmatterFields: Effect.fn(
        "Template.evaluateFrontmatterFields",
      )(function* (fields: readonly FrontmatterField[], zt: object) {
        return yield* attempt(() =>
          engine.evaluateFrontmatterFields(fields, zt),
        );
      }),
      render: Effect.fn("Template.render")(function* <T extends object>(
        name: string,
        data: T,
      ) {
        return yield* attemptRender(() => engine.render(name, data));
      }),
      renderManagedContent: Effect.fn("Template.renderManagedContent")(
        function* <T extends object>(data: T) {
          return yield* attemptRender(() => engine.renderManagedContent(data));
        },
      ),
      renderCitation: Effect.fn("Template.renderCitation")(function* (
        refs: readonly CiteRef[],
        variant: CitationVariant,
      ) {
        return yield* attemptRender(() => engine.renderCitation(refs, variant));
      }),
      renderCitationData: Effect.fn("Template.renderCitationData")(function* (
        data: CitationTemplateData,
      ) {
        return yield* attemptRender(() => engine.renderCitationData(data));
      }),
      getPartialDocument: Effect.fn("Template.getPartialDocument")(function* (
        name: string,
      ) {
        return yield* attempt(() => engine.getPartialDocument(name));
      }),
      getPartialNames: attempt(() => engine.getPartialNames()).pipe(
        Effect.withSpan("Template.getPartialNames"),
      ),
      getPartialDocuments: attempt(() => engine.getPartialDocuments()).pipe(
        Effect.withSpan("Template.getPartialDocuments"),
      ),
      getPartialEntries: attempt(() => engine.getPartialEntries()).pipe(
        Effect.withSpan("Template.getPartialEntries"),
      ),
      planPartialUnpack: Effect.fn("Template.planPartialUnpack")(function* (
        bundled: readonly LiteratureNoteTemplatePartial[],
      ) {
        return yield* attempt(() => engine.planPartialUnpack(bundled));
      }),
      unpackPartials: Effect.fn("Template.unpackPartials")(function* (
        plan: readonly LiteratureNotePartialUnpack[],
        options: { replace?: readonly string[] } = {},
      ) {
        return yield* write(
          provide(engine.unpackPartials(plan, options)).pipe(
            Effect.uninterruptible,
          ),
        );
      }),
      getReservedPartialFiles: attempt(() =>
        engine.getReservedPartialFiles(),
      ).pipe(Effect.withSpan("Template.getReservedPartialFiles")),
      createPartial: Effect.fn("Template.createPartial")(function* (
        name: string,
        options: { source?: string; language?: TemplateLanguage } = {},
      ) {
        return yield* write(
          provide(engine.createPartial(name, options)).pipe(
            Effect.uninterruptible,
          ),
        );
      }),
      deletePartial: Effect.fn("Template.deletePartial")(function* (
        name: string,
      ) {
        return yield* write(
          provide(engine.deletePartial(name)).pipe(Effect.uninterruptible),
        );
      }),
      renderPartialSource: Effect.fn("Template.renderPartialSource")(function* <
        T extends object,
      >(source: string, data: T, options: { name: string }) {
        return yield* attemptRender(() =>
          engine.renderPartialSource(source, data, options),
        );
      }),
      renderCitationSource: Effect.fn("Template.renderCitationSource")(
        function* (source: string, data: CitationTemplateData) {
          return yield* attemptRender(() =>
            engine.renderCitationSource(source, data),
          );
        },
      ),
      renderFilename: Effect.fn("Template.renderFilename")(function* <
        T extends object,
      >(data: T) {
        return yield* attemptRender(() => engine.renderFilename(data));
      }),
      analyzeRootVariables: Effect.fn("Template.analyzeRootVariables")(
        function* (name: string) {
          return yield* attempt(() => engine.analyzeRootVariables(name));
        },
      ),
      getTemplateSource: Effect.fn("Template.getTemplateSource")(function* (
        name: TemplateName,
      ) {
        return yield* owned(provide(engine.getTemplateSource(name)));
      }),
      getLegacyLiteratureNoteTemplateFiles: attempt(() =>
        engine.getLegacyLiteratureNoteTemplateFiles(),
      ).pipe(Effect.withSpan("Template.getLegacyLiteratureNoteTemplateFiles")),
      getLegacyTemplateDocuments: attempt(() =>
        engine.getLegacyTemplateDocuments(),
      ).pipe(Effect.withSpan("Template.getLegacyTemplateDocuments")),
      convertLegacyTemplateDocuments: Effect.fn(
        "Template.convertLegacyTemplateDocuments",
      )(function* (refs: readonly CiteRef[]) {
        return yield* owned(
          provide(engine.convertLegacyTemplateDocuments(refs)),
        );
      }),
      convertLegacyLiteratureNoteTemplates: Effect.fn(
        "Template.convertLegacyLiteratureNoteTemplates",
      )(function* (data: {
        readonly note: object;
        readonly filename: object;
        readonly annotation?: object;
      }) {
        return yield* owned(
          provide(engine.convertLegacyLiteratureNoteTemplates(data)),
        );
      }),
      validateFrontmatterExpr: Effect.fn("Template.validateFrontmatterExpr")(
        function* (expr: string, language: FrontmatterLanguage) {
          return yield* attempt(() =>
            engine.validateFrontmatterExpr(expr, language),
          );
        },
      ),
      setJavascriptTemplatesEnabled: Effect.fn(
        "Template.setJavascriptTemplatesEnabled",
      )(function* (enabled: boolean) {
        return yield* write(
          provide(engine.setJavascriptTemplatesEnabled(enabled)).pipe(
            Effect.uninterruptible,
          ),
        );
      }),
    });
  }),
);

export function templateFailure(cause: unknown): TemplateFailure {
  if (
    cause instanceof VaultError ||
    cause instanceof FileExists ||
    cause instanceof VaultFolderBlockedError ||
    cause instanceof TemplateError ||
    cause instanceof LegacyTemplateConversionError ||
    cause instanceof LiteratureNoteTemplateError ||
    cause instanceof PlainTemplateDocumentError ||
    cause instanceof LiteratureNotePackError ||
    cause instanceof ProfileAnnotationError ||
    cause instanceof InertTemplateError ||
    cause instanceof PartialNameError ||
    cause instanceof TemplateOperationError ||
    cause instanceof TemplateRenderError
  )
    return cause;
  return new TemplateOperationError({
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  });
}

function attempt<A>(evaluate: () => A): Effect.Effect<A, TemplateFailure> {
  return Effect.try({ try: evaluate, catch: templateFailure });
}
function attemptRender<A>(
  evaluate: () => A,
): Effect.Effect<A, TemplateFailure> {
  return Effect.try({
    try: evaluate,
    catch: (cause) => {
      const error = templateFailure(cause);
      return error instanceof TemplateOperationError
        ? new TemplateRenderError({ message: error.message, cause })
        : error;
    },
  });
}

declare module "@zotlit/obsidian-kit/view-atoms.ts" {
  interface ViewServiceRegistry {
    Template: Template;
  }
}
