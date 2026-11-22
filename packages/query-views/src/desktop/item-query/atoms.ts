import { Effect, Stream } from "effect";

import { held } from "@zotlit/obsidian-kit/view-atoms.ts";

import { QueryService } from "./service.ts";

export const queryRevisionAtom = held(
  Stream.unwrap(
    Effect.map(QueryService, (query) =>
      Stream.scan(
        query.changed,
        () => 0,
        (revision) => revision + 1,
      ),
    ),
  ),
  0,
);
