import { Effect } from "effect";

import type { LiteratureNotes } from "#desktop/query-view/table-notes.ts";

export function noLiteratureNotes(): LiteratureNotes {
  return {
    find: () => null,
    on: () => () => {},
    propertyNames: () => [],
    itemKeys: () => [],
    propertyType: () => "text",
    read: () => ({ note: false }),
    managed: () => false,
    write: () => Effect.succeed("cancelled"),
    suggestions: () => [],
    resolves: () => false,
    openLink: () => Effect.void,
    open: () => Effect.void,
    create: () => Effect.void,
  };
}
