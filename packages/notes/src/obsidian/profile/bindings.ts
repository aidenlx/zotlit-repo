import { formatProfileStamp } from "@zotlit/obsidian-kit/profile-stamp.ts";
import type {
  ProfileSelector,
  ProfileStamp,
} from "@zotlit/obsidian-kit/profile-stamp.ts";
import type { Settings } from "@zotlit/plugin-services/core/settings/schema.ts";

import type { LiteratureNoteProfile } from "./service.ts";

export interface ResolvedLiteratureNoteProfileBindings {
  readonly "note.literature-folder": string;
  readonly "citation.references-style": string | null;
  readonly "note.import-folder": string;
  readonly "note.import-colored-highlights": boolean;
  readonly "note.import-annotations-as-template": boolean;
}

export type ProfileBindingSettings = Readonly<Settings> &
  Partial<ResolvedLiteratureNoteProfileBindings>;

export function getProfileBinding<
  K extends keyof ResolvedLiteratureNoteProfileBindings,
>(
  settings: ProfileBindingSettings,
  key: K,
): ResolvedLiteratureNoteProfileBindings[K] {
  const value = settings[key] as
    | ResolvedLiteratureNoteProfileBindings[K]
    | undefined;
  return value === undefined
    ? settings["note.default-profile"].bindings[key]
    : value;
}

function mergeBindings(
  settings: Readonly<Settings>,
  profile: LiteratureNoteProfile | undefined,
): ResolvedLiteratureNoteProfileBindings {
  const bindings = profile?.bindings;
  const base = settings["note.default-profile"].bindings;
  return {
    "note.literature-folder":
      bindings?.["note.literature-folder"] ?? base["note.literature-folder"],
    "citation.references-style":
      bindings?.["citation.references-style"] !== undefined
        ? bindings["citation.references-style"]
        : base["citation.references-style"],
    "note.import-folder":
      bindings?.["note.import-folder"] ?? base["note.import-folder"],
    "note.import-colored-highlights":
      bindings?.["note.import-colored-highlights"] ??
      base["note.import-colored-highlights"],
    "note.import-annotations-as-template":
      bindings?.["note.import-annotations-as-template"] ??
      base["note.import-annotations-as-template"],
  };
}

export interface ResolvedProfile {
  readonly selector: ProfileSelector;
  readonly label: string | undefined;
  readonly stamp: string | undefined;
  readonly document: string | undefined;
  readonly bindings: ResolvedLiteratureNoteProfileBindings;
  readonly settings: ProfileBindingSettings;
  readonly citationStyle: string | null | undefined;
}

export function bindProfile(
  settings: Readonly<Settings>,
  profile: {
    selector: ProfileSelector;
    document?: string;
    entry?: LiteratureNoteProfile;
  },
): ResolvedProfile {
  const { selector, entry } = profile;
  const bindings = mergeBindings(settings, entry);
  return {
    selector,
    label: entry?.label,
    stamp: entry && formatProfileStamp(entry),
    document: profile.document,
    bindings,
    settings: { ...settings, ...bindings },
    citationStyle: entry?.bindings?.["citation.references-style"],
  };
}

export type NoteProfile =
  | { readonly ok: true; readonly profile: ResolvedProfile }
  | { readonly ok: false; readonly stamped: ProfileStamp };

export function noteProfileSelector(
  note: NoteProfile,
): ProfileSelector | undefined {
  return note.ok ? note.profile.selector : note.stamped.id;
}
