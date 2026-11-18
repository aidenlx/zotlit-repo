// The setting tab's controls of the default Profile's bindings: a control key
// names a binding of the default Literature Note Profile, and its value reads
// and writes that binding in the settings store.
import { Effect } from "effect";

import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";

import { updateDefaultLiteratureNoteProfileBindings } from "./settings.ts";

/** The control key of a default Profile binding. */
export type ProfileControlKey = `note-profile:default:${ProfileControlField}`;

export type ProfileControlField =
  | "folder"
  | "citation-style"
  | "import-folder"
  | "colored-highlights"
  | "annotations-as-template";
const bindingKeys = {
  folder: "note.literature-folder",
  "citation-style": "citation.references-style",
  "import-folder": "note.import-folder",
  "colored-highlights": "note.import-colored-highlights",
  "annotations-as-template": "note.import-annotations-as-template",
} as const;

export function isProfileControlKey(key: string): key is ProfileControlKey {
  return (
    key.startsWith("note-profile:default:") &&
    key.slice("note-profile:default:".length) in bindingKeys
  );
}

/** The default Profile binding a profile control shows. */
export function profileControlValue(key: ProfileControlKey) {
  const field = key.slice(
    "note-profile:default:".length,
  ) as ProfileControlField;
  return PluginSettings.use((settings) => settings.current).pipe(
    Effect.map(
      (current) =>
        current["note.default-profile"].bindings[bindingKeys[field]] ?? "",
    ),
  );
}

/** Store what a profile control set as the default Profile's binding. */
export function setProfileControlValue(key: ProfileControlKey, value: unknown) {
  const field = key.slice(
    "note-profile:default:".length,
  ) as ProfileControlField;
  return PluginSettings.use((settings) =>
    updateDefaultLiteratureNoteProfileBindings(settings, {
      [bindingKeys[field]]:
        field === "colored-highlights" || field === "annotations-as-template"
          ? Boolean(value)
          : field === "citation-style" && value === ""
            ? null
            : String(value),
    }),
  );
}

/** The control key of the `field` binding of the Profile `id`. */
export function profileControlKey(
  id: "default",
  field: ProfileControlField,
): ProfileControlKey {
  return `note-profile:${id}:${field}`;
}
