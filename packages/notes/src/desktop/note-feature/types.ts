import type { ResolvedProfile } from "#obsidian/profile/bindings.ts";
import type { LiteratureNoteProfile } from "#obsidian/profile/service.ts";
import type { ResolvedLiteratureNoteTemplate } from "#obsidian/template/service.ts";
import type { TFile } from "obsidian";

import type { ExcerptSummary } from "@zotlit/annotations/desktop/excerpt-image/prepare.ts";
import type { ExcerptOutcomeScope } from "@zotlit/annotations/obsidian/excerpt-image/outcome-scope.ts";
import type { Item, NoteTemplateContext } from "@zotlit/db";
import type {
  ProfileId,
  ProfileSelector,
  UnknownProfileDiagnostic,
} from "@zotlit/obsidian-kit/profile-stamp.ts";
import type { Settings } from "@zotlit/plugin-services/core/settings/schema.ts";
import type { UpdateScope } from "@zotlit/protocol";
import type { ZoteroReadsApi } from "@zotlit/zotero-reads/client/service.ts";

export interface UpdateResult {
  bodyUpdated: boolean;
  duplicateRegionCount: number;
  noManagedBlock?: true;
  diagnostic?: NoteOperationDiagnostic;
}

export interface ExistingNoteDiagnostic {
  code: "literature-note-exists" | "duplicate-literature-notes";
  hint: string;
  indexedKey: string;
  paths: [string, ...string[]];
}

export type CompanionNoteTarget =
  | { outcome: "create" }
  | {
      outcome: "existing";
      files: readonly [TFile, ...TFile[]];
      keptProfile?: Pick<ResolvedProfile, "selector" | "label">;
      diagnostic?: UnknownProfileDiagnostic;
    }
  | { outcome: "refused"; diagnostic: UnknownProfileDiagnostic };

export interface NoteProfileConflictDiagnostic {
  code: "literature-note-profile-conflict";
  hint: string;
  indexedKey: string;
  path: string;
  existingProfile: ProfileSelector;
  requestedProfile: ProfileSelector;
}

export interface MissingLiteratureNoteTemplateDiagnostic {
  code: "missing-literature-note-template";
  hint: string;
  document: string;
  path?: string;
  indexedKey?: string;
}

export interface LiteratureNoteTemplateConversionRequiredDiagnostic {
  code: "literature-note-template-conversion-required";
  hint: string;
  profileId: ProfileId;
  path?: string;
  indexedKey?: string;
}

export interface ManagedFrontmatterFailureDiagnostic {
  field: string;
  message: string;
  hint: string;
}

export interface ManagedFrontmatterRefusalDiagnostic {
  code: "managed-frontmatter-refused";
  hint: string;
  failures: [
    ManagedFrontmatterFailureDiagnostic,
    ...ManagedFrontmatterFailureDiagnostic[],
  ];
  path?: string;
  indexedKey?: string;
}

export interface NoteKeyChangedDiagnostic {
  code: "literature-note-key-changed";
  hint: string;
  indexedKey: string;
  path: string;
}

export interface NoteProfileChangedDiagnostic {
  code: "literature-note-profile-changed";
  hint: string;
  indexedKey: string;
  path: string;
}

export type NoteOperationDiagnostic =
  | UnknownProfileDiagnostic
  | NoteProfileConflictDiagnostic
  | MissingLiteratureNoteTemplateDiagnostic
  | LiteratureNoteTemplateConversionRequiredDiagnostic
  | ManagedFrontmatterRefusalDiagnostic
  | NoteKeyChangedDiagnostic
  | NoteProfileChangedDiagnostic;

export type CreateNoteDiagnostic =
  | ExistingNoteDiagnostic
  | NoteOperationDiagnostic;

export type CreateNoteResult =
  | { outcome: "created"; file: TFile }
  | { outcome: "refused"; diagnostic: CreateNoteDiagnostic };

export interface CreationProfileSources {
  headless?: ProfileSelector;
  asked?: ProfileSelector;
}

export interface CreationPlanOptions extends CreationProfileSources {
  signal?: AbortSignal;
}

export interface CreationPlan {
  item: Item | undefined;
  selection: CreationProfileSelection;
  previews: readonly PreparedCreationProfile[];
}

export type CreationProfileSource = "asked" | "headless" | "match" | "bound";

export type CreationSelectionProblem =
  | { kind: "overlap"; candidates: readonly LiteratureNoteProfile[] }
  | { kind: "unavailable-profile"; selector: ProfileSelector }
  | {
      kind: "invalid-selector";
      source: Extract<CreationProfileSource, "asked" | "headless">;
      selector: ProfileSelector;
    };

export type CreationProfileSelection = {
  selector: ProfileSelector;
  shouldAsk: boolean;
  problem?: CreationSelectionProblem;
} & (
  | { source: "match"; reason: string }
  | { source: "asked" | "headless" | "bound"; reason?: undefined }
);

export interface ProfilePreview {
  selector: ProfileSelector;
  label: string | undefined;
  folder: string;
  citationStyle: string | null;
  document: string | undefined;
  path: string | undefined;
  unavailable?: string;
}

export interface PreparedCreationProfile extends ProfilePreview {
  create: (
    options?: Pick<CreateNoteOptions, "reportExcerpts" | "outcomes" | "reads">,
  ) => Promise<CreateNoteResult>;
}

export interface ProfileNotePreview {
  path: string;
  body: string;
  properties: Record<string, unknown>;
  create: () => Promise<CreateNoteResult>;
}
export interface ProfileNotePreviewOptions {
  profile: ResolvedProfile;
  document: ResolvedLiteratureNoteTemplate;
  note: NoteTemplateContext;
  filename: object;
}

export interface PreparedProfileSwitch {
  imported: boolean;
  current: { selector: ProfileSelector | undefined; label: string | undefined };
  profiles: ProfilePreview[];
  importedNotes: TFile[] | null;
}

export type { UpdateScope };

export interface CreateNoteOptions {
  reportExcerpts?: (summary: ExcerptSummary) => void;
  outcomes?: ExcerptOutcomeScope;
  reads?: ZoteroReadsApi;
  username?: string | null;
  profile?: ProfileSelector;
}

interface CreateNoteInternalOptions extends CreateNoteOptions {
  preparedPath?: { path: string };
}

export interface WriteNoteUpdateOptions {
  reportExcerpts?: (summary: ExcerptSummary) => void;
  reads: ZoteroReadsApi;
  item: Item;
  settings: Readonly<Settings>;
  scope?: UpdateScope;
  username?: string | null;
  profile?: ProfileSelector;
  outcomes?: ExcerptOutcomeScope;
}

export interface NoteFeaturePayloads {
  "excerpt-images-reported": ExcerptSummary;
  "frontmatter-eval-failed": { itemKey: string; fields: string[] };
}

export interface NoteFeatureEventOf<K extends keyof NoteFeaturePayloads> {
  readonly _tag: K;
  readonly payload: NoteFeaturePayloads[K];
}

export type NoteFeatureEvent = {
  [K in keyof NoteFeaturePayloads]: NoteFeatureEventOf<K>;
}[keyof NoteFeaturePayloads];

export type { CreateNoteInternalOptions };
