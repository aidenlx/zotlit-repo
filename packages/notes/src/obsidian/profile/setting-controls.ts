import { Effect } from "effect";

import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";

import { updateDefaultLiteratureNoteProfileBindings } from "./settings.ts";

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

export function profileControlKey(
  id: "default",
  field: ProfileControlField,
): ProfileControlKey {
  return `note-profile:${id}:${field}`;
}
