import type { TFile } from "obsidian";

import type { ExcerptOutcomeScope } from "@zotlit/annotations/obsidian/excerpt-image/outcome-scope.ts";
import type { Item } from "@zotlit/db";
import type { ProfileSelector } from "@zotlit/obsidian-kit/profile-stamp.ts";
import type { UpdateScope } from "@zotlit/protocol";

import type { NoteCitations } from "./citations-handle.ts";
import type { NoteCreation } from "./creation-handle.ts";
import type {
  CreateNoteOptions,
  CreateNoteResult,
  UpdateResult,
} from "./types.ts";

export type {
  CompanionNoteTarget,
  CreateNoteDiagnostic,
  CreateNoteOptions,
  CreateNoteResult,
  CreationPlanOptions,
  CreationProfileSelection,
  CreationProfileSource,
  CreationProfileSources,
  CreationSelectionProblem,
  NoteOperationDiagnostic,
  ProfileNotePreview,
  ProfilePreview,
  UpdateResult,
  UpdateScope,
} from "./types.ts";

export interface NoteFeatureHandle extends NoteCitations, NoteCreation {
  updateNote(
    file: TFile,
    options: {
      indexedKey: string;
      scope?: UpdateScope;
      profile?: ProfileSelector;
      beforeWrite?: () => void;
    },
  ): Promise<UpdateResult>;
  getImportedNotesForItem(indexedKey: string): Promise<TFile[]>;
  replacedKeys(file: TFile): Promise<ReadonlySet<string>>;
  createNote(
    item: Item,
    options?: CreateNoteOptions,
  ): Promise<CreateNoteResult>;
  overwriteNote(
    file: TFile,
    indexedKey: string,
    options?: { outcomes?: ExcerptOutcomeScope },
  ): Promise<UpdateResult>;
}
