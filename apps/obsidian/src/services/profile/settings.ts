// The default Profile key of the plugin settings, and its write.
import { Effect } from "effect";
import * as v from "valibot";

import { settingsSlice } from "@zotlit/plugin-services/core/settings/slice.ts";
import type {
  PluginSettings,
  SettingsMutationError,
} from "@zotlit/plugin-services/obsidian/settings/service.ts";

import type { ResolvedLiteratureNoteProfileBindings } from "./bindings.ts";

const defaultLiteratureNoteProfileSchema = v.pipe(
  v.object({
    bindings: v.pipe(
      v.object({
        "note.literature-folder": v.string(),
        "citation.references-style": v.nullable(v.string()),
        "note.import-folder": v.string(),
        "note.import-colored-highlights": v.boolean(),
        "note.import-annotations-as-template": v.boolean(),
      }),
      v.readonly(),
    ),
  }),
  v.readonly(),
);

export type DefaultLiteratureNoteProfile = v.InferOutput<
  typeof defaultLiteratureNoteProfileSchema
>;

/** The built-in Profile is the total inheritance root for vault-local bindings. */
export const DEFAULT_LITERATURE_NOTE_PROFILE = Object.freeze({
  bindings: Object.freeze({
    "note.literature-folder": "literatures",
    "citation.references-style": null,
    "note.import-folder": "zotero_notes",
    "note.import-colored-highlights": false,
    "note.import-annotations-as-template": false,
  }),
}) satisfies DefaultLiteratureNoteProfile;

export const profileSettings = settingsSlice(
  { "note.default-profile": defaultLiteratureNoteProfileSchema },
  { "note.default-profile": DEFAULT_LITERATURE_NOTE_PROFILE },
);

/** Merge `patch` into the default Profile's bindings. */
export const updateDefaultLiteratureNoteProfileBindings = Effect.fn(
  "PluginSettings.updateDefaultLiteratureNoteProfileBindings",
)(function* (
  settings: Pick<PluginSettings["Service"], "update">,
  patch: Partial<ResolvedLiteratureNoteProfileBindings>,
): Effect.fn.Return<void, SettingsMutationError> {
  yield* settings.update((current) => ({
    "note.default-profile": {
      ...current["note.default-profile"],
      bindings: { ...current["note.default-profile"].bindings, ...patch },
    },
  }));
});
