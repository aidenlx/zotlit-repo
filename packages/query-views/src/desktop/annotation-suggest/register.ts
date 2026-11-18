import type { Plugin } from "obsidian";

import { AnnotationEditorSuggest } from "./annotation-suggest.ts";
import type { AnnotationSuggestDeps } from "./annotation-suggest.ts";

/**
 * The Annotation Suggester, registered after the Citation Suggester: their
 * triggers never overlap, so at most one of them opens on any text.
 */
export function registerAnnotationSuggest(
  plugin: Pick<Plugin, "registerEditorSuggest">,
  deps: AnnotationSuggestDeps,
): void {
  plugin.registerEditorSuggest(new AnnotationEditorSuggest(deps));
}
