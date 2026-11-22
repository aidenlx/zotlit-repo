import type { Library } from "#queries/libraries.ts";
import { Effect } from "effect";

import { checkLayout, defineStatement } from "./database.ts";
import type { ItemQueryDatabase, ItemQueryReaderError } from "./database.ts";

import { selectLibraries } from "#queries/libraries.ts";

const withClientVersion = defineStatement<Record<string, never>>("libraries")(
  (db) => selectLibraries(db, { clientVersion: true }),
);

const withoutClientVersion = defineStatement<Record<string, never>>(
  "libraries",
)((db) => selectLibraries(db, { clientVersion: false }));

export function readLibraries(): Effect.Effect<
  Library[],
  ItemQueryReaderError,
  ItemQueryDatabase
> {
  return Effect.gen(function* () {
    const layout = yield* checkLayout();
    const statement = layout.has("libraries", "clientVersion")
      ? withClientVersion
      : withoutClientVersion;
    return yield* statement.all({});
  });
}
