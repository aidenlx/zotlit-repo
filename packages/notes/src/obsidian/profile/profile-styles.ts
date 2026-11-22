import { Effect, Layer } from "effect";

import { ProfileStyles } from "@zotlit/citations/obsidian/pandoc/profile-styles.ts";
import type { Settings } from "@zotlit/plugin-services/core/settings/schema.ts";

import { Profile } from "./service.ts";

export const defaultProfileStyle = (settings: Readonly<Settings>) =>
  settings["note.default-profile"].bindings["citation.references-style"];

export const layerProfileStyles: Layer.Layer<ProfileStyles, never, Profile> =
  Layer.effect(
    ProfileStyles,
    Effect.gen(function* () {
      const profile = yield* Profile;
      return ProfileStyles.of({
        state: profile.state,
        changes: profile.changes,
        loaded: profile.loaded,
        profileOf: (file) => profile.profileOf(file),
        vaultStyleId: defaultProfileStyle,
      });
    }),
  );
