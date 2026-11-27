import type { ProfileMatch } from "#obsidian/profile-selection/index.ts";
import type {
  LiteratureNoteTemplateStatus,
  TemplateFailure,
  TemplateStatus,
} from "#obsidian/template/service.ts";
import {
  Cause,
  Context,
  Effect,
  Fiber,
  Layer,
  PubSub,
  Ref,
  Schema,
  Scope,
  Semaphore,
  Stream,
  SubscriptionRef,
} from "effect";
import { customAlphabet } from "nanoid";
import type { TFile } from "obsidian";
import { parseDocument } from "yaml";

import {
  processLiveText,
  readLiveText,
} from "@zotlit/obsidian-kit/effect-live-text.ts";
import type { LiveTextRewriteFailed } from "@zotlit/obsidian-kit/effect-live-text.ts";
import { normalizeFolderPath } from "@zotlit/obsidian-kit/ensure-folder.ts";
import {
  parseFrontMatter,
  spliceFrontMatter,
} from "@zotlit/obsidian-kit/live-text.ts";
import { FileManager } from "@zotlit/obsidian-kit/obsidian-file-manager.ts";
import { MetadataCache } from "@zotlit/obsidian-kit/obsidian-metadata-cache.ts";
import { Vault } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import { Workspace } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import {
  DEFAULT_PROFILE,
  isProfileId,
  PROFILE_ID_LENGTH,
  PROFILE_ID_RULE,
  profileStampOf,
} from "@zotlit/obsidian-kit/profile-stamp.ts";
import type {
  ProfileId,
  ProfileSelector,
} from "@zotlit/obsidian-kit/profile-stamp.ts";
import { ensureVaultParentFolder } from "@zotlit/obsidian-kit/vault-folder.ts";
import { FIELD_LITERATURE_NOTE_PROFILE } from "@zotlit/plugin-kernel/constants.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import { isScopeClosed } from "@zotlit/plugin-kernel/effect-scope.ts";
import type {
  VaultError,
  FileExists,
  VaultFolderBlockedError,
} from "@zotlit/plugin-kernel/vault-errors.ts";
import { join } from "@zotlit/plugin-kernel/vault-path.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import type { Settings } from "@zotlit/plugin-services/core/settings/schema.ts";
import { NoteIndex } from "@zotlit/plugin-services/obsidian/note-index/service.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import {
  TemplateFacade,
  parseLiteratureNoteTemplate,
  synthesizeLegacyLiteratureNoteTemplate,
  updateLiteratureNoteTemplateMatch,
} from "@zotlit/templates/facade";
import type {
  LiteratureNoteTemplateManifest,
  MatchTree,
} from "@zotlit/templates/facade";
import {
  LiteratureNotePackError,
  updateLiteratureNotePackMetadata,
} from "@zotlit/templates/literature-note-pack";
import type { LiteratureNotePartialUnpack } from "@zotlit/templates/literature-note-pack";

import type {
  NoteProfile,
  ResolvedProfile,
  ResolvedLiteratureNoteProfileBindings,
} from "./bindings.ts";
import { bindProfile } from "./bindings.ts";
import { relocatedNotePath } from "./relocation.ts";

import {
  DEFAULT_FRONTMATTER_FIELDS,
  DEFAULT_TEMPLATES,
  RESERVED_PARTIAL_NAMES,
} from "#core/template/defaults.ts";
import { compileProfileMatch } from "#obsidian/profile-selection/index.ts";
import { Template } from "#obsidian/template/service.ts";
const mintId = customAlphabet(
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  PROFILE_ID_LENGTH,
);

export type ProfileBindings = Pick<
  LiteratureNoteTemplateManifest,
  | "folder"
  | "citationStyle"
  | "importFolder"
  | "importColoredHighlights"
  | "importAnnotationsAsTemplate"
>;

export const DEFAULT_PROFILE_DOCUMENT = "zotlit-profile.default.md";

export interface LiteratureNoteProfile {
  readonly id: ProfileId;
  readonly label: string;
  readonly document: string;
  readonly path: string;
  readonly bindings: Partial<ResolvedLiteratureNoteProfileBindings>;
  readonly match: ProfileMatch;
}

export interface ProfileCreateOptions {
  label: string;
  look?: ProfileSelector;
  source?: string;
  bindings?: ProfileBindings;
}

export interface PreparedProfileCreation {
  profile: ResolvedProfile;
  source: string;
  inherited: ("folder" | "citationStyle" | "look")[];
  constraint?: { kind: "invalid-name"; message: string };
  create(): Promise<LiteratureNoteProfile>;
}

export interface ProfileImportOptions {
  inheritCitationStyle?: boolean;
  folder?: string | null;
  citationStyle?: string | null;
  stripFolders?: boolean;
  includeMatch?: boolean;
}

export interface ProfileShareOptions {
  version: string;
  author: string;
  description: string;
  includeFolders?: boolean;
  includeMatch?: boolean;
  partials?: readonly string[];
}

export interface PreparedProfileShare {
  readonly manifest: LiteratureNoteTemplateManifest;
  readonly partials: readonly string[];
  readonly reachable: readonly string[];
  readonly missing: readonly string[];
  readonly filename: string;
  render(options: ProfileShareOptions): string;
}

export type PreparedProfileImport = {
  manifest: LiteratureNoteTemplateManifest;
  profile: ResolvedProfile;
  source: string;
  path: string;
  partials: readonly LiteratureNotePartialUnpack[];
  previewSource(options?: { replacePartials?: readonly string[] }): string;
  import(options?: {
    includeMatch?: ProfileImportOptions["includeMatch"];
    replacePartials?: readonly string[];
  }): Promise<LiteratureNoteProfile>;
} & (
  | { kind: "fresh" }
  | {
      kind: "replace";
      held: {
        label: string;
        version: string;
        literatureNotes: number;
        importedNotes: number;
      };
    }
);

export interface ProfileDiagnostic {
  readonly code: "invalid-profile-document" | "duplicate-profile-id";
  readonly path: string;
  readonly message: string;
  readonly paths?: readonly string[];
  readonly reason?: "invalid-profile-id";
}

export type ProfileDocumentExpectation =
  | { readonly state: "absent" }
  | { readonly state: "revision"; readonly revision: string };

export type ProfileDocumentWrite =
  | { readonly state: "saved"; readonly revision: string }
  | {
      readonly state: "refused";
      readonly reason: "revision-conflict" | "document-exists";
      readonly currentRevision?: string;
    };

class ProfileDocumentConflict extends Error {
  readonly current: string;

  constructor(current: string) {
    super("The Profile document changed since it was read.");
    this.name = "ProfileDocumentConflict";
    this.current = current;
  }
}

export interface ProfileDeletionTarget {
  profile: ResolvedProfile;
  files: { file: TFile; path: string }[];
}

export interface ProfileDeletionPlan {
  source: LiteratureNoteProfile;
  literatureNotes: TFile[];
  importedNotes: TFile[];
  targets: ProfileDeletionTarget[];
}

export interface ProfileDeletionResult {
  literatureNotes: number;
  importedNotes: number;
  movedFiles: number;
}

export interface ProfileReader {
  readonly loaded: boolean;
  readonly profiles: readonly LiteratureNoteProfile[];
  resolveProfile(selector: ProfileSelector): ResolvedProfile | undefined;
  profileOf(file?: TFile): NoteProfile;
  readonly changed: Stream.Stream<void>;
}
const makeProfileEngine = Effect.fnUntraced(function* (
  changed: () => Effect.Effect<void>,
  profileRevision: ProfileRevision,
) {
  const metadata = yield* MetadataCache;
  const vault = yield* Vault;
  const fileManager = yield* FileManager;
  const settings = yield* PluginSettings;
  const template = yield* Template;
  const noteIndex = yield* NoteIndex;
  const workspace = yield* Workspace;
  const semaphore = yield* Semaphore.make(1);
  const mutate = semaphore.withPermits(1);
  const readText = (file: TFile) =>
    readLiveText(file).pipe(
      Effect.provideService(Vault, vault),
      Effect.provideService(Workspace, workspace),
    );
  const rewrite = (file: TFile, fn: (text: string) => string) =>
    processLiveText(file, fn).pipe(
      Effect.provideService(Vault, vault),
      Effect.provideService(Workspace, workspace),
    );
  const ensureParent = (path: string) =>
    ensureVaultParentFolder(path).pipe(Effect.provideService(Vault, vault));
  const log = (message: string, fields: Record<string, unknown>) =>
    Effect.logDebug(message).pipe(
      Effect.annotateLogs(fields),
      withLogCategory("profile"),
    );
  const registry = yield* Ref.make({
    profiles: [] as LiteratureNoteProfile[],
    diagnostics: [] as ProfileDiagnostic[],
    defaultDocument: undefined as string | undefined,
    defaultExcluded: false,
    loaded: false,
    scannedTemplateStatus: undefined as TemplateStatus | undefined,
  });
  const defaultDocumentPath = Effect.fnUntraced(function* () {
    return yield* documentPathIn((yield* settings.current)["template.folder"]);
  });
  const documentPathIn = Effect.fnUntraced(function* (folder: string) {
    return join(
      folder,
      (yield* Ref.get(registry)).defaultDocument ?? DEFAULT_PROFILE_DOCUMENT,
    );
  });
  const resolveProfile = Effect.fn("Profile.resolveProfile")(function* (
    selector: ProfileSelector,
  ): Effect.fn.Return<ResolvedProfile | undefined, ProfileOperationError> {
    if (!(yield* Ref.get(registry)).loaded)
      return yield* operationError(new Error("ProfileService is not ready"));
    const saved = yield* settings.current;
    if (selector === DEFAULT_PROFILE) {
      return (yield* Ref.get(registry)).defaultExcluded
        ? undefined
        : bindProfile(saved, {
            selector,
            document: (yield* Ref.get(registry)).defaultDocument,
          });
    }
    const entry = (yield* Ref.get(registry)).profiles.find(
      ({ id }) => id === selector,
    );
    return (
      entry && bindProfile(saved, { selector, document: entry.document, entry })
    );
  });
  const profileOf = Effect.fn("Profile.profileOf")(function* (
    file?: TFile,
  ): Effect.fn.Return<NoteProfile, ProfileOperationError> {
    const stamped = file && profileStampOf(yield* metadata.fileCache(file));
    const profile =
      stamped === undefined
        ? yield* resolveProfile(DEFAULT_PROFILE)
        : stamped.id === undefined
          ? undefined
          : yield* resolveProfile(stamped.id);
    return profile
      ? { ok: true, profile }
      : {
          ok: false,
          stamped: stamped ?? { stamp: DEFAULT_PROFILE, id: undefined },
        };
  });
  const prepareCreate = Effect.fn("Profile.prepareCreate")(function* (
    options: ProfileCreateOptions,
  ): Effect.fn.Return<ProfileCreation, ProfileOperationError | VaultError> {
    const requestedLabel = options.label.trim();
    const label = requestedLabel || m.settings_profile_new_name();
    const base = yield* resolveProfile(DEFAULT_PROFILE);
    if (!base)
      return yield* operationError(new Error(m.notice_profile_action_failed()));
    const baseline = yield* getSource(DEFAULT_PROFILE);
    const source =
      options.source ??
      (options.look === undefined || options.look === DEFAULT_PROFILE
        ? baseline
        : yield* getSource(options.look));
    const facade = new TemplateFacade();
    const defaultLook = yield* attempt(() =>
      facade.parseLiteratureNoteTemplate(baseline),
    );
    const look =
      source === baseline
        ? defaultLook
        : yield* attempt(() => facade.parseLiteratureNoteTemplate(source));
    const differs =
      look.body !== defaultLook.body ||
      look.annotationSection.source !== defaultLook.annotationSection.source ||
      (["filename", "language", "frontmatter", "partials"] as const).some(
        (key) =>
          JSON.stringify(look.manifest[key]) !==
          JSON.stringify(defaultLook.manifest[key]),
      );
    const bindings = { ...options.bindings };
    for (const [key, binding] of Object.entries(PROFILE_BINDING_KEYS)) {
      const name = key as keyof ProfileBindings;
      const value = bindings[name];
      const inherited = base.bindings[binding];
      if (
        value === undefined ||
        value === inherited ||
        ((name === "folder" || name === "importFolder") &&
          typeof value === "string" &&
          normalizeFolderPath(value) ===
            normalizeFolderPath(inherited as string))
      )
        delete bindings[name];
    }
    const constraint = yield* validateLabel(requestedLabel).pipe(
      Effect.catch((error) =>
        Effect.succeed({
          kind: "invalid-name" as const,
          message: error.message,
        }),
      ),
    );
    const id = mintId() as ProfileId;
    const content = yield* attempt(() =>
      profileSource(source, { id, label, bindings }),
    );
    const folder = (yield* settings.current)["template.folder"];
    const plainDocument = `zotlit-profile.${profileSlug(label)}.md`;
    const document = (yield* vault.getAbstractFileByPath(
      join(folder, plainDocument),
    ))
      ? `zotlit-profile.${profileSlug(label)}-${id}.md`
      : plainDocument;
    const entry: LiteratureNoteProfile = {
      id,
      label,
      match: compileProfileMatch(look.manifest.match),
      document,
      path: join(folder, document),
      bindings: Object.fromEntries(
        Object.entries(bindings).map(([key, value]) => [
          PROFILE_BINDING_KEYS[key as keyof ProfileBindings],
          value,
        ]),
      ),
    };
    const inherited: PreparedProfileCreation["inherited"] = [];
    if (bindings.folder === undefined) inherited.push("folder");
    if (bindings.citationStyle === undefined) inherited.push("citationStyle");
    if (!differs) inherited.push("look");
    const profile = bindProfile(yield* settings.current, {
      selector: id,
      document: entry.document,
      entry,
    });
    yield* log("Prepared Profile creation", { id, label, inherited });
    return {
      profile,
      source: content,
      inherited,
      constraint,
      create: () =>
        mutate(
          Effect.gen(function* () {
            if (constraint)
              return yield* operationError(new Error(constraint.message));
            return yield* persist(label, id, content);
          }),
        ),
    };
  });
  const create = Effect.fn("Profile.create")(function* (
    options: ProfileCreateOptions,
  ): Effect.fn.Return<
    LiteratureNoteProfile,
    | ProfileOperationError
    | VaultError
    | FileExists
    | VaultFolderBlockedError
    | TemplateFailure
  > {
    return yield* (yield* prepareCreate(options)).create();
  });
  const getSource = Effect.fn("Profile.getSource")(function* (
    selector: ProfileSelector,
  ): Effect.fn.Return<string, ProfileOperationError | VaultError> {
    const profile = yield* resolveProfile(selector);
    if (!profile)
      return yield* operationError(
        new Error(m.settings_profile_source_unavailable({ profile: selector })),
      );
    if (profile.document) {
      const file = yield* vault.getFileByPath(yield* documentPath(profile));
      if (!file)
        return yield* operationError(
          new Error(
            m.settings_profile_source_missing({ document: profile.document }),
          ),
        );
      return yield* readText(file);
    }
    return yield* getBuiltInSource();
  });
  const saveSource = Effect.fn("Profile.saveSource")(function* (
    selector: ProfileSelector,
    source: string,
    expected: ProfileDocumentExpectation,
  ): Effect.fn.Return<
    ProfileDocumentWrite,
    | ProfileOperationError
    | VaultError
    | VaultFolderBlockedError
    | LiveTextRewriteFailed
    | TemplateFailure
  > {
    return yield* mutate(
      Effect.gen(function* () {
        yield* settle();
        const profile = yield* resolveProfile(selector);
        if (!profile)
          return yield* operationError(
            new Error(
              m.settings_profile_source_unavailable({ profile: selector }),
            ),
          );
        return yield* Effect.gen(function* () {
          const write = yield* writeDocument(
            yield* documentPath(profile),
            source,
            expected,
          );
          if (write.state === "saved") {
            yield* settle();
            yield* log("Saved a Profile document", { selector });
          }
          return write;
        }).pipe(Effect.uninterruptible);
      }),
    );
  });
  const documentPath = Effect.fn("Profile.documentPath")(function* (
    profile: ResolvedProfile,
  ): Effect.fn.Return<string, never> {
    return profile.document
      ? join((yield* settings.current)["template.folder"], profile.document)
      : yield* defaultDocumentPath();
  });
  const writeDocument = Effect.fn("Profile.writeDocument")(function* (
    path: string,
    source: string,
    expected: ProfileDocumentExpectation,
  ): Effect.fn.Return<
    ProfileDocumentWrite,
    VaultError | VaultFolderBlockedError | LiveTextRewriteFailed
  > {
    const file = yield* vault.getFileByPath(path);
    if (!file) {
      if (expected.state === "revision")
        return { state: "refused", reason: "revision-conflict" };
      yield* ensureParent(path);
      const held = yield* createDocument(path, source);
      if (held !== undefined) return yield* documentExists(held);
      return { state: "saved", revision: profileRevision(source) };
    }
    if (expected.state === "absent") return yield* documentExists(path);
    const conflict = yield* rewrite(file, (current) => {
      if (profileRevision(current) !== expected.revision)
        throw new ProfileDocumentConflict(current);
      return source;
    }).pipe(
      Effect.as(undefined as string | undefined),
      Effect.catchTag("LiveTextRewriteFailed", (error) =>
        error.cause instanceof ProfileDocumentConflict
          ? Effect.succeed(error.cause.current)
          : Effect.fail(error),
      ),
    );
    if (conflict !== undefined)
      return {
        state: "refused",
        reason: "revision-conflict",
        currentRevision: profileRevision(conflict),
      };
    return { state: "saved", revision: profileRevision(source) };
  });
  const createDocument = Effect.fn("Profile.createDocument")(function* (
    path: string,
    data: string,
  ): Effect.fn.Return<string | undefined, VaultError> {
    return yield* vault.create(path, data).pipe(
      Effect.as(undefined),
      Effect.catchTag("FileExists", (error) => Effect.succeed(error.path)),
    );
  });
  const documentExists = Effect.fn("Profile.documentExists")(function* (
    path: string,
  ): Effect.fn.Return<ProfileDocumentWrite, VaultError> {
    const file = yield* vault.getFileByPath(path);
    return {
      state: "refused",
      reason: "document-exists",
      ...(file
        ? {
            currentRevision: profileRevision(
              yield* readText(file).pipe(Effect.interruptible),
            ),
          }
        : {}),
    };
  });
  const setMatch = Effect.fn("Profile.setMatch")(function* (
    id: ProfileId,
    match: MatchTree | undefined,
  ): Effect.fn.Return<
    void,
    ProfileOperationError | VaultError | TemplateFailure
  > {
    return yield* mutate(
      Effect.gen(function* () {
        yield* settle();
        const profile = (yield* Ref.get(registry)).profiles.find(
          (entry) => entry.id === id,
        );
        if (!profile)
          return yield* operationError(new Error(m.profile_import_changed()));
        const file = yield* vault.getFileByPath(profile.path);
        if (!file)
          return yield* operationError(new Error(m.profile_import_changed()));
        return yield* Effect.gen(function* () {
          yield* rewrite(file, (source) => {
            if (parseLiteratureNoteTemplate(source).manifest.id !== id)
              throw new Error(m.profile_import_changed());
            return updateLiteratureNoteTemplateMatch(source, match);
          }).pipe(
            Effect.catchTag("LiveTextRewriteFailed", (error) =>
              Effect.fail(operationError(error.cause)),
            ),
          );
          yield* settle();
          yield* log("Updated Profile match", {
            id,
            removed: match === undefined,
          });
        }).pipe(Effect.uninterruptible);
      }),
    );
  });
  const getBuiltInSource = Effect.fn("Profile.getBuiltInSource")(
    function* (): Effect.fn.Return<string, ProfileOperationError> {
      const fields = (yield* settings.current)["note.frontmatter-fields"];
      return yield* attempt(() =>
        synthesizeLegacyLiteratureNoteTemplate(
          {
            note: { source: DEFAULT_TEMPLATES.note, language: "liquid" },
            content: { source: DEFAULT_TEMPLATES.content, language: "liquid" },
            filename: {
              source: DEFAULT_TEMPLATES.filename,
              language: "liquid",
            },
          },
          {
            id: DEFAULT_PROFILE,
            name: m.settings_profile_default_name(),
            description: m.profile_default_description(),
            managed: false,
            frontmatter: fields ?? DEFAULT_FRONTMATTER_FIELDS,
          },
        ),
      );
    },
  );
  const duplicate = Effect.fn("Profile.duplicate")(function* (
    selector: ProfileSelector,
    options: {
      label?: string;
    } = {},
  ): Effect.fn.Return<
    LiteratureNoteProfile,
    | ProfileOperationError
    | VaultError
    | FileExists
    | VaultFolderBlockedError
    | TemplateFailure
  > {
    return yield* mutate(
      Effect.gen(function* () {
        const profile = yield* resolveProfile(selector);
        if (!profile)
          return yield* operationError(
            new Error(`Unknown Profile: ${selector}`),
          );
        const label = profile.label ?? m.settings_profile_default_name();
        const base = options.label ?? m.settings_profile_copy_name({ label });
        let copyLabel = base;
        let number = 2;
        while (
          (yield* Ref.get(registry)).profiles.some(
            (entry) =>
              entry.label.toLocaleLowerCase() === copyLabel.toLocaleLowerCase(),
          )
        )
          copyLabel = `${base} ${number++}`;
        const id = mintId() as ProfileId;
        const source = yield* getSource(selector);
        return yield* persist(
          copyLabel,
          id,
          yield* attempt(() => profileSource(source, { id, label: copyLabel })),
        );
      }),
    );
  });
  const prepareShare = Effect.fn("Profile.prepareShare")(function* (
    selector: ProfileSelector,
  ): Effect.fn.Return<
    ProfileShare,
    ProfileOperationError | VaultError | TemplateFailure
  > {
    yield* settle();
    const profile = yield* resolveProfile(selector);
    if (!profile)
      return yield* operationError(
        new Error(m.settings_profile_source_unavailable({ profile: selector })),
      );
    const id =
      selector === DEFAULT_PROFILE ? (mintId() as ProfileId) : selector;
    const label = profile.label ?? m.settings_profile_default_name();
    const bindings = Object.fromEntries(
      Object.entries(PROFILE_BINDING_KEYS).map(([key, binding]) => [
        key,
        profile.bindings[binding],
      ]),
    ) as ProfileBindings;
    const missingPartials = new Set<string>();
    const effectiveSource = yield* getSource(selector);
    const source = yield* template.exportLiteratureNotePackSource(
      yield* attempt(() =>
        updateProfilePackMetadata(effectiveSource, {
          id,
          name: label,
          ...bindings,
        }),
      ),
      {
        includeFolders: true,
        onMissingPartial: (name) => missingPartials.add(name),
      },
    );
    const facade = new TemplateFacade();
    const { manifest } = yield* attempt(() =>
      facade.parseLiteratureNoteTemplate(source),
    );
    const bundled = manifest.partials ?? [];
    const entries = new Map(
      [...(yield* template.getPartialEntries), ...bundled].map(
        (partial) => [partial.name, partial] as const,
      ),
    );
    const offered = (names: Iterable<string>) =>
      [...names]
        .filter((name) => !RESERVED_PARTIAL_NAMES.has(name))
        .sort((left, right) => left.localeCompare(right));
    const partials = offered(entries.keys());
    const reachable = offered(bundled.map(({ name }) => name));
    const carried = bundled.filter(({ name }) =>
      RESERVED_PARTIAL_NAMES.has(name),
    );
    const missing = offered(missingPartials);
    yield* log("Prepared Profile sharing", {
      selector,
      id,
      partials,
      reachable,
      missing,
    });
    return {
      manifest,
      partials,
      reachable,
      missing,
      filename: `zotlit-profile.${profileSlug(label)}${selector === DEFAULT_PROFILE ? `-${id}` : ""}.md`,
      render: (options) =>
        attempt(() => {
          const version = options.version.trim();
          if (!version) throw new Error(m.profile_share_version_required());
          const checked = [
            ...carried,
            ...(options.partials ?? reachable).flatMap((name) => {
              const entry = entries.get(name);
              return entry ? [entry] : [];
            }),
          ].sort((left, right) => left.name.localeCompare(right.name));
          return updateProfilePackMetadata(
            source,
            {
              version,
              author: options.author.trim() || undefined,
              description: options.description.trim() || undefined,
              ...(!options.includeFolders
                ? { folder: undefined, importFolder: undefined }
                : {}),
              partials: checked.length > 0 ? checked : undefined,
            },
            { includeMatch: options.includeMatch },
          );
        }),
    };
  });
  const validateLabel = Effect.fnUntraced(function* (label: string) {
    const slug = profileSlug(label);
    if (
      !slug ||
      slug === DEFAULT_PROFILE ||
      (yield* Ref.get(registry)).profiles.some(
        (profile) =>
          profile.label.toLocaleLowerCase() === label.toLocaleLowerCase(),
      )
    )
      return yield* operationError(
        new Error(m.settings_profile_name_invalid()),
      );
  });
  const persist = Effect.fn("Profile.persist")(
    function* (
      label: string,
      id: ProfileId,
      content: string,
    ): Effect.fn.Return<
      LiteratureNoteProfile,
      | ProfileOperationError
      | VaultError
      | FileExists
      | VaultFolderBlockedError
      | TemplateFailure
    > {
      yield* validateLabel(label);
      const folder = (yield* settings.current)["template.folder"];
      let path = join(folder, `zotlit-profile.${profileSlug(label)}.md`);
      yield* ensureParent(path);
      if ((yield* createDocument(path, content)) !== undefined) {
        path = join(folder, `zotlit-profile.${profileSlug(label)}-${id}.md`);
        yield* vault.create(path, content);
      }
      yield* settle();
      const entry = (yield* Ref.get(registry)).profiles.find(
        (profile) => profile.id === id,
      );
      if (!entry)
        return yield* operationError(
          new Error(`Profile document could not be registered: ${path}`),
        );
      return entry;
    },
    (effect) => Effect.uninterruptible(effect),
  );
  const prepareImport = Effect.fn("Profile.prepareImport")(function* (
    source: string,
    options: ProfileImportOptions = {},
  ): Effect.fn.Return<
    ProfileImport,
    ProfileOperationError | VaultError | TemplateFailure
  > {
    yield* settle();
    const parsed = yield* Effect.try({
      try: () => new TemplateFacade().parseLiteratureNoteTemplate(source),
      catch: (cause) =>
        operationError(new Error(m.profile_import_invalid(), { cause })),
    });
    if (parsed.manifest.id === DEFAULT_PROFILE)
      return yield* operationError(new Error(m.profile_import_default()));
    if (!isProfileId(parsed.manifest.id))
      return yield* operationError(new Error(m.settings_profile_id_invalid()));
    const id = parsed.manifest.id;
    const held = yield* importTarget(id);
    const includeMatch = options.includeMatch !== false;
    const metadata = {
      ...(options.stripFolders
        ? { folder: undefined, importFolder: undefined }
        : {}),
      ...(options.folder !== undefined
        ? { folder: options.folder ?? undefined }
        : {}),
      ...(options.inheritCitationStyle
        ? { citationStyle: undefined }
        : options.citationStyle !== undefined
          ? { citationStyle: options.citationStyle }
          : {}),
    };
    const render = (include: boolean) =>
      updateProfilePackMetadata(source, metadata, { includeMatch: include });
    const content = yield* attempt(() => render(includeMatch));
    const { manifest } = yield* attempt(() =>
      new TemplateFacade().parseLiteratureNoteTemplate(content),
    );
    const folder = (yield* settings.current)["template.folder"];
    const slug = profileSlug(manifest.name);
    const plain = `zotlit-profile.${slug}.md`;
    const document =
      held?.document ??
      (!slug ||
      slug === DEFAULT_PROFILE ||
      (yield* vault.getAbstractFileByPath(join(folder, plain)))
        ? `zotlit-profile.${slug || "profile"}-${id}.md`
        : plain);
    const path = held?.path ?? join(folder, document);
    const entry: LiteratureNoteProfile = {
      id,
      label: manifest.name,
      match: compileProfileMatch(manifest.match),
      document,
      path,
      bindings: Object.fromEntries(
        Object.entries(PROFILE_BINDING_KEYS).flatMap(([key, value]) =>
          manifest[key as keyof ProfileBindings] === undefined
            ? []
            : [[value, manifest[key as keyof ProfileBindings]]],
        ),
      ),
    };
    const heldSource = held ? yield* getSource(id) : undefined;
    let decision:
      | Pick<
          Extract<
            PreparedProfileImport,
            {
              kind: "replace";
            }
          >,
          "kind" | "held"
        >
      | {
          kind: "fresh";
        } = { kind: "fresh" };
    if (held) {
      yield* noteIndex.whenIndexed;
      const notes = yield* noteIndex.getNotesByProfile(id);
      const heldManifest = (yield* attempt(() =>
        new TemplateFacade().parseLiteratureNoteTemplate(heldSource!),
      )).manifest;
      decision = {
        kind: "replace",
        held: {
          label: held.label,
          version: heldManifest.version,
          literatureNotes: notes.literatureNotes.length,
          importedNotes: notes.importedNotes.length,
        },
      };
    }
    const partials = yield* template.planPartialUnpack(manifest.partials ?? []);
    yield* log("Prepared Profile import", {
      id,
      path,
      kind: decision.kind,
      partials: partials.map(({ name, verdict }) => `${name}:${verdict}`),
    });
    return {
      ...decision,
      manifest,
      source: content,
      path,
      partials,
      profile: bindProfile(yield* settings.current, {
        selector: id,
        document,
        entry,
      }),
      previewSource: ({ replacePartials = [] } = {}) =>
        attempt(() => {
          const replace = new Set(replacePartials);
          return withoutBundledPartials(
            content,
            partials.flatMap(({ name, verdict }) =>
              verdict === "unchanged" ||
              (verdict === "conflict" && !replace.has(name))
                ? [name]
                : [],
            ),
          );
        }),
      import: ({
        includeMatch: approvedMatch = includeMatch,
        replacePartials,
      } = {}) =>
        mutate(
          Effect.gen(function* () {
            yield* settle();
            const current = yield* importTarget(id);
            if (current?.path !== held?.path)
              return yield* operationError(
                new Error(m.profile_import_changed()),
              );
            return yield* Effect.gen(function* () {
              const { dropped } = yield* template.unpackPartials(partials, {
                replace: replacePartials,
              });
              const importedContent = yield* attempt(() =>
                withoutBundledPartials(
                  approvedMatch === includeMatch
                    ? content
                    : render(approvedMatch),
                  dropped,
                ),
              );
              if (held) {
                const file = yield* vault.getFileByPath(path);
                if (!file)
                  return yield* operationError(
                    new Error(m.profile_import_changed()),
                  );
                yield* rewrite(file, (currentSource) => {
                  if (currentSource !== heldSource)
                    throw new Error(m.profile_import_changed());
                  return importedContent;
                }).pipe(
                  Effect.catchTag("LiveTextRewriteFailed", (error) =>
                    Effect.fail(operationError(error.cause)),
                  ),
                );
              } else {
                yield* ensureParent(path);
                yield* vault.create(path, importedContent).pipe(
                  Effect.catchTag("FileExists", (error) =>
                    Effect.fail(
                      new ProfileImportChanged({
                        message: m.profile_import_changed(),
                        cause: error,
                      }),
                    ),
                  ),
                );
              }
              yield* settle();
              const imported = (yield* Ref.get(registry)).profiles.find(
                (profile) => profile.id === id,
              );
              if (!imported)
                return yield* operationError(
                  new Error(m.profile_import_excluded()),
                );
              yield* log("Imported Profile document", {
                id,
                path,
                replaced: !!held,
              });
              return imported;
            }).pipe(Effect.uninterruptible);
          }),
        ),
    };
  });
  const importTarget = Effect.fn("Profile.importTarget")(function* (
    id: ProfileId,
  ): Effect.fn.Return<
    LiteratureNoteProfile | undefined,
    ProfileOperationError | TemplateFailure
  > {
    const matches = (yield* template.getLiteratureNoteTemplateStatuses).filter(
      (status) =>
        status.reference.startsWith("zotlit-profile.") &&
        documentId(status) === id,
    );
    const held = (yield* Ref.get(registry)).profiles.find(
      (profile) => profile.id === id,
    );
    if (matches.length > 1 || (matches.length && !held))
      return yield* operationError(new Error(m.profile_import_excluded()));
    return held;
  });
  const ejectDefault = Effect.fn("Profile.ejectDefault")(
    function* (): Effect.fn.Return<
      TFile,
      | ProfileOperationError
      | VaultError
      | FileExists
      | VaultFolderBlockedError
      | TemplateFailure
    > {
      return (yield* materializeDefault()).file;
    },
  );
  const materializeDefault = Effect.fn("Profile.materializeDefault")(
    function* (): Effect.fn.Return<
      {
        file: TFile;
        created: boolean;
      },
      | ProfileOperationError
      | VaultError
      | FileExists
      | VaultFolderBlockedError
      | TemplateFailure
    > {
      const path = yield* defaultDocumentPath();
      yield* ensureParent(path);
      const { file, created } = yield* vault
        .create(path, yield* getBuiltInSource())
        .pipe(
          Effect.map((file) => ({ file, created: true })),
          Effect.catchTag(
            "FileExists",
            Effect.fnUntraced(function* (error) {
              const existing = yield* vault.getFileByPath(error.path);
              return existing
                ? { file: existing, created: false }
                : yield* error;
            }),
          ),
        );
      yield* settle();
      return { file, created };
    },
    (effect) => mutate(Effect.uninterruptible(effect)),
  );
  const restoreDefault = Effect.fn("Profile.restoreDefault")(
    function* (): Effect.fn.Return<
      void,
      ProfileOperationError | VaultError | TemplateFailure
    > {
      const path = yield* defaultDocumentPath();
      const file = yield* vault.getFileByPath(path);
      if (file) yield* fileManager.trashFile(file);
      yield* settle();
    },
    (effect) => mutate(Effect.uninterruptible(effect)),
  );
  const prepareDelete = Effect.fn("Profile.prepareDelete")(function* (
    id: ProfileId,
  ): Effect.fn.Return<ProfileDeletionPlan, ProfileOperationError> {
    const source = (yield* Ref.get(registry)).profiles.find(
      (profile) => profile.id === id,
    );
    if (!source)
      return yield* operationError(new Error("The Profile is unavailable"));
    yield* noteIndex.whenIndexed;
    const { literatureNotes, importedNotes } =
      yield* noteIndex.getNotesByProfile(id);
    const selectors: ProfileSelector[] = [
      DEFAULT_PROFILE,
      ...(yield* Ref.get(registry)).profiles
        .filter((profile) => profile.id !== id)
        .map(({ id }) => id),
    ];
    const current = yield* resolveProfile(id);
    const targets = yield* Effect.forEach(
      selectors,
      Effect.fnUntraced(function* (selector) {
        const profile = yield* resolveProfile(selector);
        if (!profile) return [];
        const files = [
          ...literatureNotes.map((file) => ({
            file,
            path: relocatedNotePath(file, {
              from: current,
              to: profile,
              imported: false,
            }),
          })),
          ...importedNotes.map((file) => ({
            file,
            path: relocatedNotePath(file, {
              from: current,
              to: profile,
              imported: true,
            }),
          })),
        ];
        return [{ profile, files }];
      }),
    ).pipe(Effect.map((entries) => entries.flat()));
    yield* log("Prepared Profile deletion", {
      id,
      literatureNotes: literatureNotes.length,
      importedNotes: importedNotes.length,
    });
    return { source, literatureNotes, importedNotes, targets };
  });
  const deleteProfile = Effect.fn("Profile.delete")(function* (
    id: ProfileId,
    target: ProfileSelector,
    options: {
      move?: boolean;
    } = {},
  ): Effect.fn.Return<
    ProfileDeletionResult,
    | ProfileOperationError
    | VaultError
    | FileExists
    | VaultFolderBlockedError
    | LiveTextRewriteFailed
    | TemplateFailure
  > {
    return yield* mutate(
      Effect.gen(function* () {
        const plan = yield* prepareDelete(id);
        const destination = plan.targets.find(
          ({ profile }) => profile.selector === target,
        );
        if (
          !destination &&
          (plan.literatureNotes.length || plan.importedNotes.length)
        )
          return yield* operationError(
            new Error("Select an available target Profile before deleting"),
          );
        return yield* Effect.gen(function* () {
          let movedFiles = 0;
          const stamp = destination?.profile.stamp;
          for (const { file, path } of destination?.files ?? []) {
            if (options.move && path !== file.path) {
              yield* ensureParent(path);
              yield* fileManager.renameFile(file, path);
              movedFiles++;
            }
            yield* rewrite(file, (text) => {
              const frontmatter = parseFrontMatter(text);
              if (stamp === undefined)
                delete frontmatter[FIELD_LITERATURE_NOTE_PROFILE];
              else frontmatter[FIELD_LITERATURE_NOTE_PROFILE] = stamp;
              return spliceFrontMatter(text, frontmatter);
            });
          }
          const file = yield* vault.getFileByPath(plan.source.path);
          if (file) yield* fileManager.trashFile(file);
          yield* settle();
          const result = {
            literatureNotes: plan.literatureNotes.length,
            importedNotes: plan.importedNotes.length,
            movedFiles,
          };
          yield* log("Deleted Profile after moving its notes", {
            id,
            target,
            ...result,
          });
          return result;
        }).pipe(Effect.uninterruptible);
      }),
    );
  });
  const settle = Effect.fn("Profile.settle")(function* (): Effect.fn.Return<
    void,
    ProfileOperationError | TemplateFailure
  > {
    if ((yield* template.waitUntilSettled(5000)) !== "settled")
      return yield* operationError(
        new Error("Profile documents did not finish scanning"),
      );
    yield* scan();
  });
  const scan = Effect.fn("Profile.scan")(function* (): Effect.fn.Return<
    void,
    TemplateFailure
  > {
    const templateStatus = yield* template.status;
    if (templateStatus === (yield* Ref.get(registry)).scannedTemplateStatus)
      return;
    const profiles: LiteratureNoteProfile[] = [];
    const diagnostics: ProfileDiagnostic[] = [];
    let defaultDocument: string | undefined;
    let defaultExcluded = false;
    const statuses = (yield* template.getLiteratureNoteTemplateStatuses).filter(
      ({ reference }) => reference.startsWith("zotlit-profile."),
    );
    for (const status of statuses) {
      const validation = status.validation;
      const id = documentId(status);
      if (
        validation.state === "invalid" ||
        (id !== DEFAULT_PROFILE && !isProfileId(id!))
      ) {
        diagnostics.push({
          code: "invalid-profile-document",
          path: status.path,
          ...(validation.state === "valid"
            ? { reason: "invalid-profile-id" as const }
            : {}),
          message:
            validation.state === "invalid"
              ? validation.error.message
              : PROFILE_ID_RULE,
        });
        yield* log("Excluded invalid Profile document {path}", {
          path: status.path,
          id,
        });
        if (
          id === DEFAULT_PROFILE ||
          status.reference === DEFAULT_PROFILE_DOCUMENT
        ) {
          defaultExcluded = true;
          defaultDocument = status.reference;
        }
      }
    }
    const groups = Map.groupBy(
      statuses.filter((status) => {
        const id = documentId(status);
        return id === DEFAULT_PROFILE || (id !== undefined && isProfileId(id));
      }),
      documentId,
    );
    for (const [id, group] of groups) {
      if (group.length > 1) {
        const paths = group.map(({ path }) => path);
        yield* log("Excluded duplicate Profile ID {id} in {paths}", {
          id,
          paths,
        });
        for (const { path } of group)
          diagnostics.push({
            code: "duplicate-profile-id",
            path,
            paths,
            message: `Profile ID '${id}' is shared by ${paths.join(", ")}.`,
          });
        if (id === DEFAULT_PROFILE) defaultExcluded = true;
        continue;
      }
      const status = group[0]!;
      if (status.validation.state !== "valid") continue;
      if (id === DEFAULT_PROFILE) {
        defaultDocument = status.reference;
        continue;
      }
      const entry = seedProfileEntry(status.validation.manifest, {
        document: status.reference,
        path: status.path,
      });
      if (entry.match.state === "unevaluable")
        yield* log("Profile match cannot be evaluated", {
          id: entry.id,
          problem: entry.match.problem,
        });
      profiles.push(entry);
    }
    yield* log(
      "Profile scan completed with {profiles} Profiles and {diagnostics} diagnostics",
      {
        profiles: profiles.length,
        diagnostics: diagnostics.length,
        defaultDocument: defaultDocument,
        defaultExcluded: defaultExcluded,
      },
    );
    yield* Ref.set(registry, {
      profiles,
      diagnostics,
      defaultDocument,
      defaultExcluded,
      loaded: true,
      scannedTemplateStatus: templateStatus,
    });
    yield* changed();
  });
  return {
    documentPathIn,
    resolveProfile,
    profileOf,
    prepareCreate,
    getSource,
    saveSource,
    setMatch,
    getBuiltInSource,
    duplicate,
    prepareShare,
    prepareImport,
    ejectDefault,
    materializeDefault,
    restoreDefault,
    prepareDelete,
    delete: deleteProfile,
    scan,
    create,
    defaultDocumentPath,
    loaded: Ref.get(registry).pipe(Effect.map((value) => value.loaded)),
    profiles: Ref.get(registry).pipe(Effect.map((value) => value.profiles)),
    diagnostics: Ref.get(registry).pipe(
      Effect.map((value) => value.diagnostics),
    ),
  };
});
export function bindDraftProfile(
  settings: Readonly<Settings>,
  selector: ProfileSelector,
  manifest: LiteratureNoteTemplateManifest,
): ResolvedProfile {
  return selector === DEFAULT_PROFILE
    ? bindProfile(settings, { selector: DEFAULT_PROFILE })
    : bindProfile(settings, {
        selector,
        entry: {
          ...seedProfileEntry(manifest, { document: "", path: "" }),
          id: selector,
        },
      });
}

export function bindUnvalidatedDraftProfile(
  settings: Readonly<Settings>,
  manifest: LiteratureNoteTemplateManifest,
): ResolvedProfile {
  return bindDraftProfile(settings, manifest.id as ProfileSelector, manifest);
}

export function seedProfileEntry(
  manifest: LiteratureNoteTemplateManifest,
  options: {
    document: string;
    path: string;
  },
): LiteratureNoteProfile {
  const match = compileProfileMatch(manifest.match);
  return {
    id: manifest.id as ProfileId,
    label: manifest.name,
    match,
    document: options.document,
    path: options.path,
    bindings: {
      ...(manifest.folder === undefined
        ? {}
        : { "note.literature-folder": manifest.folder }),
      ...(manifest.citationStyle === undefined
        ? {}
        : { "citation.references-style": manifest.citationStyle }),
      ...(manifest.importFolder === undefined
        ? {}
        : { "note.import-folder": manifest.importFolder }),
      ...(manifest.importColoredHighlights === undefined
        ? {}
        : {
            "note.import-colored-highlights": manifest.importColoredHighlights,
          }),
      ...(manifest.importAnnotationsAsTemplate === undefined
        ? {}
        : {
            "note.import-annotations-as-template":
              manifest.importAnnotationsAsTemplate,
          }),
    },
  };
}

function documentId(status: LiteratureNoteTemplateStatus): string | undefined {
  return status.validation.state === "valid"
    ? status.validation.manifest.id
    : status.validation.manifestId;
}

function profileSlug(label: string): string {
  return label
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replaceAll(/[^\p{L}\p{N}]+/gu, "-")
    .replaceAll(/^-|-$/g, "");
}

const PROFILE_BINDING_KEYS = {
  folder: "note.literature-folder",
  citationStyle: "citation.references-style",
  importFolder: "note.import-folder",
  importColoredHighlights: "note.import-colored-highlights",
  importAnnotationsAsTemplate: "note.import-annotations-as-template",
} as const;

function profileSource(
  source: string,
  options: { id: ProfileId; label: string; bindings?: ProfileBindings },
): string {
  const facade = new TemplateFacade();
  facade.parseLiteratureNoteTemplate(source);
  const headerEnd = source.indexOf("\n---", source.indexOf("---") + 3);
  const header = parseDocument(source.slice(4, headerEnd));
  header.set("id", options.id);
  header.set("name", options.label);
  if (options.bindings !== undefined) {
    for (const key of Object.keys(PROFILE_BINDING_KEYS)) header.delete(key);
    for (const [key, value] of Object.entries(options.bindings))
      header.set(key, value);
  }
  const content = `---\n${header.toString()}---${source.slice(headerEnd + 4)}`;
  facade.parseLiteratureNoteTemplate(content);
  return content;
}

function withoutBundledPartials(
  source: string,
  dropped: readonly string[],
): string {
  if (dropped.length === 0) return source;
  const { manifest } = new TemplateFacade().parseLiteratureNoteTemplate(source);
  const kept = (manifest.partials ?? []).filter(
    ({ name }) => !dropped.includes(name),
  );
  return updateProfilePackMetadata(source, {
    partials: kept.length > 0 ? kept : undefined,
  });
}

function updateProfilePackMetadata(
  source: string,
  changes: Parameters<typeof updateLiteratureNotePackMetadata>[1],
  options: Parameters<typeof updateLiteratureNotePackMetadata>[2] = {},
): string {
  try {
    return updateLiteratureNotePackMetadata(source, changes, options);
  } catch (error) {
    if (
      error instanceof LiteratureNotePackError &&
      error.code === "match-changed"
    )
      throw new Error(m.profile_match_metadata_changed(), { cause: error });
    throw error;
  }
}

export class ProfileImportChanged extends Schema.TaggedError<
  ProfileImportChanged,
  { readonly brand: unique symbol }
>()("ProfileImportChanged", {
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

export class ProfileOperationError extends Schema.TaggedError<
  ProfileOperationError,
  { readonly brand: unique symbol }
>()("ProfileOperationError", {
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

export class ProfileDocumentMissingError extends Schema.TaggedError<
  ProfileDocumentMissingError,
  { readonly brand: unique symbol }
>()("ProfileDocumentMissingError", {
  profileId: Schema.String,
  message: Schema.String,
}) {}

export interface ProfileState {
  readonly loaded: boolean;
  readonly profiles: readonly LiteratureNoteProfile[];
  readonly diagnostics: readonly ProfileDiagnostic[];
  readonly defaultDocumentPath: string;
  readonly templateStatus: import("#obsidian/template/service.ts").TemplateStatus;
  readonly failure?: Cause.Cause<TemplateFailure>;
}
type ProfileOperationErrors = {
  resolveProfile: ProfileOperationError;
  profileOf: ProfileOperationError;
  getBuiltInSource: ProfileOperationError;
  create:
    | ProfileOperationError
    | VaultError
    | FileExists
    | VaultFolderBlockedError
    | TemplateFailure;
  getSource: ProfileOperationError | VaultError | TemplateFailure;
  saveSource:
    | ProfileOperationError
    | VaultError
    | VaultFolderBlockedError
    | LiveTextRewriteFailed
    | TemplateFailure;
  setMatch: ProfileOperationError | VaultError | TemplateFailure;
  duplicate:
    | ProfileOperationError
    | VaultError
    | FileExists
    | VaultFolderBlockedError
    | TemplateFailure;
  ejectDefault:
    | ProfileOperationError
    | VaultError
    | FileExists
    | VaultFolderBlockedError
    | TemplateFailure;
  materializeDefault:
    | ProfileOperationError
    | VaultError
    | FileExists
    | VaultFolderBlockedError
    | TemplateFailure;
  restoreDefault: ProfileOperationError | VaultError | TemplateFailure;
  prepareDelete: ProfileOperationError | TemplateFailure;
  delete:
    | ProfileOperationError
    | VaultError
    | FileExists
    | VaultFolderBlockedError
    | LiveTextRewriteFailed
    | TemplateFailure;
};
export type ProfileCreation = Omit<PreparedProfileCreation, "create"> & {
  create(): Effect.Effect<
    LiteratureNoteProfile,
    | ProfileOperationError
    | VaultError
    | FileExists
    | VaultFolderBlockedError
    | TemplateFailure
  >;
};
export type ProfileImport = PreparedProfileImport extends infer P
  ? P extends PreparedProfileImport
    ? Omit<P, "import" | "previewSource"> & {
        import(
          options?: Parameters<P["import"]>[0],
        ): Effect.Effect<
          LiteratureNoteProfile,
          | ProfileOperationError
          | ProfileImportChanged
          | VaultError
          | VaultFolderBlockedError
          | TemplateFailure
        >;
        previewSource(
          options?: Parameters<P["previewSource"]>[0],
        ): Effect.Effect<string, ProfileOperationError>;
      }
    : never
  : never;
export type ProfileShare = Omit<PreparedProfileShare, "render"> & {
  render(
    options: ProfileShareOptions,
  ): Effect.Effect<string, ProfileOperationError>;
};
export class Profile extends Context.Service<
  Profile,
  {
    readonly state: Effect.Effect<ProfileState>;
    readonly changes: Stream.Stream<ProfileState>;
    readonly loaded: Effect.Effect<boolean>;
    readonly profiles: Effect.Effect<readonly LiteratureNoteProfile[]>;
    readonly diagnostics: Effect.Effect<readonly ProfileDiagnostic[]>;
    readonly defaultDocumentPath: Effect.Effect<string>;
    resolveProfile(
      selector: ProfileSelector,
    ): Effect.Effect<
      ResolvedProfile | undefined,
      ProfileOperationErrors["resolveProfile"]
    >;
    profileOf(
      file?: TFile,
    ): Effect.Effect<NoteProfile, ProfileOperationErrors["profileOf"]>;
    readonly getBuiltInSource: Effect.Effect<
      string,
      ProfileOperationErrors["getBuiltInSource"]
    >;
    create(
      options: ProfileCreateOptions,
    ): Effect.Effect<LiteratureNoteProfile, ProfileOperationErrors["create"]>;
    getSource(
      selector: ProfileSelector,
    ): Effect.Effect<string, ProfileOperationErrors["getSource"]>;
    saveSource(
      selector: ProfileSelector,
      source: string,
      expected: ProfileDocumentExpectation,
    ): Effect.Effect<
      ProfileDocumentWrite,
      ProfileOperationErrors["saveSource"]
    >;
    setMatch(
      id: ProfileId,
      match: MatchTree | undefined,
    ): Effect.Effect<void, ProfileOperationErrors["setMatch"]>;
    duplicate(
      selector: ProfileSelector,
      options?: { label?: string },
    ): Effect.Effect<
      LiteratureNoteProfile,
      ProfileOperationErrors["duplicate"]
    >;
    readonly ejectDefault: Effect.Effect<
      TFile,
      ProfileOperationErrors["ejectDefault"]
    >;
    readonly materializeDefault: Effect.Effect<
      { file: TFile; created: boolean },
      ProfileOperationErrors["materializeDefault"]
    >;
    readonly restoreDefault: Effect.Effect<
      void,
      ProfileOperationErrors["restoreDefault"]
    >;
    prepareDelete(
      id: ProfileId,
    ): Effect.Effect<
      ProfileDeletionPlan,
      ProfileOperationErrors["prepareDelete"]
    >;
    delete(
      id: ProfileId,
      target: ProfileSelector,
      options?: { move?: boolean },
    ): Effect.Effect<ProfileDeletionResult, ProfileOperationErrors["delete"]>;
    prepareCreate(
      options: ProfileCreateOptions,
    ): Effect.Effect<
      ProfileCreation,
      ProfileOperationError | VaultError | TemplateFailure
    >;
    prepareImport(
      source: string,
      options?: ProfileImportOptions,
    ): Effect.Effect<
      ProfileImport,
      ProfileOperationError | VaultError | TemplateFailure
    >;
    prepareShare(
      selector: ProfileSelector,
    ): Effect.Effect<
      ProfileShare,
      ProfileOperationError | VaultError | TemplateFailure
    >;
  }
>()("zotlit/profile/Profile") {}
const operationError = (cause: unknown) =>
  cause instanceof ProfileOperationError
    ? cause
    : new ProfileOperationError({
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      });
const attempt = <A>(read: () => A) =>
  Effect.try({ try: read, catch: operationError });
export type ProfileRevision = (source: string) => string;

export const layerProfile = (profileRevision: ProfileRevision) =>
  Layer.effect(
    Profile,
    Effect.gen(function* () {
      const settings = yield* PluginSettings;
      const template = yield* Template;
      const scope = yield* Scope.Scope;
      const engine = yield* makeProfileEngine(
        (): Effect.Effect<void> => publish(),
        profileRevision,
      );
      const snapshot = Effect.fnUntraced(function* (
        failure?: ProfileState["failure"],
      ): Effect.fn.Return<ProfileState> {
        return {
          loaded: yield* engine.loaded,
          profiles: yield* engine.profiles,
          diagnostics: yield* engine.diagnostics,
          defaultDocumentPath: yield* engine.defaultDocumentPath(),
          templateStatus: yield* template.status,
          ...(failure ? { failure } : {}),
        } satisfies ProfileState;
      });
      const state = yield* SubscriptionRef.make(yield* snapshot());
      const publish = Effect.fnUntraced(function* (): Effect.fn.Return<void> {
        yield* SubscriptionRef.set(state, yield* snapshot());
      });
      const scan = engine.scan().pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.interrupt
            : Effect.gen(function* () {
                yield* SubscriptionRef.set(state, yield* snapshot(cause));
                yield* Effect.logWarning("Profile scan failed", cause);
              }),
        ),
      );
      yield* scan;
      const startupFailure = (yield* SubscriptionRef.get(state)).failure;
      yield* Stream.runForEach(template.changes, () => scan).pipe(
        Effect.forkScoped({ startImmediately: true }),
      );
      yield* Stream.runForEach(
        settings.changes,
        Effect.fnUntraced(function* (saved) {
          const path = yield* engine.documentPathIn(saved["template.folder"]);
          yield* SubscriptionRef.update(state, (previous) => ({
            ...previous,
            defaultDocumentPath: path,
          }));
        }),
      ).pipe(Effect.forkScoped({ startImmediately: true }));
      yield* Effect.addFinalizer(() => PubSub.shutdown(state.pubsub));
      const owned = <A, E>(effect: Effect.Effect<A, E>) =>
        Effect.suspend((): Effect.Effect<A, E | TemplateFailure> =>
          startupFailure
            ? Effect.failCause(startupFailure)
            : isScopeClosed(scope)
              ? Effect.interrupt
              : Effect.forkIn(effect, scope, { startImmediately: true }).pipe(
                  Effect.flatMap((fiber) => Fiber.join(fiber)),
                ),
        );
      return Profile.of({
        state: SubscriptionRef.get(state),
        changes: SubscriptionRef.changes(state),
        loaded: engine.loaded,
        profiles: engine.profiles,
        diagnostics: engine.diagnostics,
        defaultDocumentPath: engine.defaultDocumentPath(),
        resolveProfile: engine.resolveProfile,
        profileOf: engine.profileOf,
        getBuiltInSource: engine.getBuiltInSource(),
        create: Effect.fn("Profile.create")(
          (...args: Parameters<Profile["Service"]["create"]>) =>
            owned(engine.create(...args)),
        ),
        getSource: Effect.fn("Profile.getSource")(
          (...args: Parameters<Profile["Service"]["getSource"]>) =>
            owned(engine.getSource(...args)),
        ),
        saveSource: Effect.fn("Profile.saveSource")(
          (...args: Parameters<Profile["Service"]["saveSource"]>) =>
            owned(engine.saveSource(...args)),
        ),
        setMatch: Effect.fn("Profile.setMatch")(
          (...args: Parameters<Profile["Service"]["setMatch"]>) =>
            owned(engine.setMatch(...args)),
        ),
        duplicate: Effect.fn("Profile.duplicate")(
          (...args: Parameters<Profile["Service"]["duplicate"]>) =>
            owned(engine.duplicate(...args)),
        ),
        ejectDefault: owned(engine.ejectDefault()).pipe(
          Effect.withSpan("Profile.ejectDefault"),
        ),
        materializeDefault: owned(engine.materializeDefault()).pipe(
          Effect.withSpan("Profile.materializeDefault"),
        ),
        restoreDefault: owned(engine.restoreDefault()).pipe(
          Effect.withSpan("Profile.restoreDefault"),
        ),
        prepareDelete: Effect.fn("Profile.prepareDelete")(
          (...args: Parameters<Profile["Service"]["prepareDelete"]>) =>
            owned(engine.prepareDelete(...args)),
        ),
        delete: Effect.fn("Profile.delete")(
          (...args: Parameters<Profile["Service"]["delete"]>) =>
            owned(engine.delete(...args)),
        ),
        prepareCreate: Effect.fn("Profile.prepareCreate")(function* (options) {
          const plan = yield* owned(engine.prepareCreate(options));
          return { ...plan, create: () => owned(plan.create()) };
        }),
        prepareImport: Effect.fn("Profile.prepareImport")(
          function* (source, options) {
            const plan = yield* owned(engine.prepareImport(source, options));
            return {
              ...plan,
              import: (options) => owned(plan.import(options)),
            };
          },
        ),
        prepareShare: Effect.fn("Profile.prepareShare")((selector) =>
          owned(engine.prepareShare(selector)),
        ),
      });
    }).pipe(withLogCategory("profile")),
  );

declare module "@zotlit/obsidian-kit/view-atoms.ts" {
  interface ViewServiceRegistry {
    Profile: Profile;
  }
}
