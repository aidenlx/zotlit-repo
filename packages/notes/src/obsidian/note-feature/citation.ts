import { Effect } from "effect";

import type { CitationVariant, CiteRef } from "@zotlit/db";

import { Profile } from "#obsidian/profile/service.ts";
import { Template } from "#obsidian/template/service.ts";

export const renderCitation = Effect.fn("NoteFeature.renderCitation")(
  function* (items: readonly CiteRef[], variant: CitationVariant) {
    const template = yield* Template;
    if (!(yield* template.loaded) || !(yield* (yield* Profile).loaded))
      return null;
    return yield* template.renderCitation(items, variant);
  },
);
