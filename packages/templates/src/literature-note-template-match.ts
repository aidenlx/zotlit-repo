import { updateLiteratureNoteTemplateManifestKey } from "./literature-note-template-manifest-edit.ts";
import type { MatchTree } from "./literature-note-template.ts";

export function updateLiteratureNoteTemplateMatch(
  source: string,
  match: MatchTree | undefined,
): string {
  return updateLiteratureNoteTemplateManifestKey(source, "match", match);
}
