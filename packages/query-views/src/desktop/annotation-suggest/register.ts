import type { Plugin } from "obsidian";

import { AnnotationEditorSuggest } from "./annotation-suggest.ts";
import type { AnnotationSuggestDeps } from "./annotation-suggest.ts";

export function registerAnnotationSuggest(
  plugin: Pick<Plugin, "registerEditorSuggest">,
  deps: AnnotationSuggestDeps,
): void {
  plugin.registerEditorSuggest(new AnnotationEditorSuggest(deps));
}
