import type { Cause, Effect, Stream } from "effect";
import { Context } from "effect";
import type { TFile } from "obsidian";

import type {
  ProfileSelector,
  ProfileStamp,
} from "@zotlit/obsidian-kit/profile-stamp.ts";
import type { Settings } from "@zotlit/plugin-services/core/settings/schema.ts";

export interface StyleProfile {
  readonly selector: ProfileSelector;
  readonly label: string | undefined;
  readonly bindings: { readonly "citation.references-style": string | null };
}

export type NoteStyleProfile =
  | { readonly ok: true; readonly profile: StyleProfile }
  | { readonly ok: false; readonly stamped: ProfileStamp };

export interface ProfileStyleReader {
  readonly loaded: boolean;
  profileOf(file?: TFile): NoteStyleProfile;
}

export class ProfileStyles extends Context.Service<
  ProfileStyles,
  {
    readonly state: Effect.Effect<unknown>;
    readonly changes: Stream.Stream<unknown>;
    readonly loaded: Effect.Effect<boolean>;
    profileOf(
      file?: TFile,
    ): Effect.Effect<NoteStyleProfile, Cause.YieldableError>;
    vaultStyleId(settings: Readonly<Settings>): string | null;
  }
>()("zotlit/pandoc/ProfileStyles") {}

declare module "@zotlit/obsidian-kit/view-atoms.ts" {
  interface ViewServiceRegistry {
    ProfileStyles: ProfileStyles;
  }
}
