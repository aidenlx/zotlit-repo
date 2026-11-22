import type { ResolveStart, SuggestionConfig } from "#core/language/index.ts";

import * as m from "@zotlit/plugin-messages/messages.ts";

import type { WorkbenchHost } from "./host.tsx";

export function partialSuggestions(
  dependencies: readonly string[],
  {
    partials,
    start,
  }: {
    readonly partials: WorkbenchHost["partials"] | undefined;
    readonly start: ResolveStart;
  },
): Pick<SuggestionConfig, "partials" | "createPartial"> {
  if (!partials) return { partials: dependencies };
  return {
    partials: partials.names(),
    createPartial: {
      label: m.workbench_partial_new(),
      detail: m.workbench_partial_new_detail(),
      run: (query) => partials.create(query),
      start,
    },
  };
}
