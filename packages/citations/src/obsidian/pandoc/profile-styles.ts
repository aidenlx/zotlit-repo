// The Literature Note Profiles a Citation Presentation reads, which the notes
// feature owns: whether they have loaded, the Profile a note belongs to with
// the Citation and References Style it binds, and the vault's style, which the
// default Profile binds. The notes feature provides the layer.
import { Context } from "effect";
import type { Cause, Effect, Stream } from "effect";
import type { TFile } from "obsidian";

import type {
  ProfileSelector,
  ProfileStamp,
} from "@zotlit/obsidian-kit/profile-stamp.ts";
import type { Settings } from "@zotlit/plugin-services/core/settings/schema.ts";

/** One Profile, as a Citation Presentation reads it. */
export interface StyleProfile {
  readonly selector: ProfileSelector;
  /** The label as the user wrote it; `undefined` for the default Profile. */
  readonly label: string | undefined;
  readonly bindings: { readonly "citation.references-style": string | null };
}

/** The Profile a note belongs to, or the parsed stamp that names no Profile. */
export type NoteStyleProfile =
  | { readonly ok: true; readonly profile: StyleProfile }
  | { readonly ok: false; readonly stamped: ProfileStamp };

/** The Profiles read synchronously, as a plain caller holds them. */
export interface ProfileStyleReader {
  readonly loaded: boolean;
  profileOf(file?: TFile): NoteStyleProfile;
}

export class ProfileStyles extends Context.Service<
  ProfileStyles,
  {
    /**
     * The Profiles' current state, which `changes` emits first. A reader
     * compares it by identity only.
     */
    readonly state: Effect.Effect<unknown>;
    readonly changes: Stream.Stream<unknown>;
    readonly loaded: Effect.Effect<boolean>;
    profileOf(
      file?: TFile,
    ): Effect.Effect<NoteStyleProfile, Cause.YieldableError>;
    /** The vault's Citation and References Style: the default Profile's binding. */
    vaultStyleId(settings: Readonly<Settings>): string | null;
  }
>()("zotlit/pandoc/ProfileStyles") {}

declare module "@zotlit/obsidian-kit/view-atoms.ts" {
  interface ViewServiceRegistry {
    ProfileStyles: ProfileStyles;
  }
}
