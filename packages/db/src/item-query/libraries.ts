import type { Library } from "#queries/libraries.ts";
// The Library reader of Item Query: the statement of `getLibraries`
// (`selectLibraries`) through the statement seam of the readers. It selects
// `libraries.clientVersion` only when the layout of the copy has it, so it
// runs on every copy that passes the layout check, whatever its version
// stamps are.
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

/**
 * Read the personal Library and every group Library of the copy, as
 * `getLibraries` gives them: one {@link Library} row each, in `libraryID`
 * order.
 */
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
