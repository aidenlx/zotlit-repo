import { regex } from "arkregex";
import type { CachedMetadata, MetadataCache, TFile } from "obsidian";

import { FIELD_LITERATURE_NOTE_PROFILE } from "@zotlit/plugin-kernel/constants.ts";

export const PROFILE_ID_LENGTH = 12;

const PROFILE_ID_SOURCE = `[A-Za-z0-9]{${PROFILE_ID_LENGTH}}`;

export const PROFILE_ID_PATTERN = new RegExp(`^${PROFILE_ID_SOURCE}$`);

export const PROFILE_ID_RULE = `The Profile ID must contain ${PROFILE_ID_LENGTH} letters or digits.`;

const STAMPED_ID = regex(`\\((?<id>${PROFILE_ID_SOURCE})\\)$`);

declare const PROFILE_ID: unique symbol;

export type ProfileId = string & { readonly [PROFILE_ID]: true };

export function isProfileId(value: string): value is ProfileId {
  return PROFILE_ID_PATTERN.test(value);
}

export const DEFAULT_PROFILE = "default";

export type ProfileSelector = ProfileId | typeof DEFAULT_PROFILE;

export interface ProfileStamp {
  readonly stamp: string;
  readonly id: ProfileId | undefined;
}

export function parseProfileStamp(value: unknown): ProfileStamp | undefined {
  if (value === undefined) return undefined;
  // oxlint-disable-next-line no-base-to-string
  const stamp = String(value);
  const parenthesised = STAMPED_ID.exec(stamp)?.groups.id as
    | ProfileId
    | undefined;
  return {
    stamp,
    id: parenthesised ?? (isProfileId(stamp) ? stamp : undefined),
  };
}

export function formatProfileStamp(profile: {
  id: string;
  label: string;
}): string {
  return `${profile.label.trim()} (${profile.id})`;
}

export function readProfileStamp(
  metadataCache: Pick<MetadataCache, "getFileCache">,
  file: TFile,
): ProfileStamp | undefined {
  return profileStampOf(metadataCache.getFileCache(file));
}

export function profileStampOf(
  cache: CachedMetadata | null,
): ProfileStamp | undefined {
  return parseProfileStamp(cache?.frontmatter?.[FIELD_LITERATURE_NOTE_PROFILE]);
}

export function parseProfileSelector(
  text: string,
): ProfileSelector | undefined {
  if (text === DEFAULT_PROFILE) return DEFAULT_PROFILE;
  return isProfileId(text) ? text : undefined;
}

export const UNKNOWN_PROFILE_HINT =
  "Use Switch profile... to choose an available Profile for this note.";

export interface UnknownProfileDiagnostic {
  readonly code: "unknown-literature-note-profile";
  readonly hint: string;
  readonly recovery: { readonly action: "switch-profile" };
  readonly stamp: string;
  readonly path?: string;
  readonly indexedKey?: string;
}

export function unknownProfileDiagnostic(
  stamp: string,
  context: { path?: string; indexedKey?: string } = {},
): UnknownProfileDiagnostic {
  return {
    code: "unknown-literature-note-profile",
    hint: UNKNOWN_PROFILE_HINT,
    recovery: { action: "switch-profile" },
    stamp,
    ...context,
  };
}
