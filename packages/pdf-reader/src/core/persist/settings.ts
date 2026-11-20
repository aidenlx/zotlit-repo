import type { ReaderHost } from "#/core/host.ts";
import type { FindState, ReaderState } from "#/core/types.ts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const SIDEBAR_KEY = "sidebar";
const FIND_KEY = "find-options";
const THEMED_KEY = "themed";

export const MIN_SIDEBAR_WIDTH = 140;

const Sidebar = Schema.Struct({
  open: Schema.Boolean,
  panel: Schema.Literals(["thumbnails", "outline"]),
  width: Schema.Finite,
});

const FindOptions = Schema.Struct({
  caseSensitive: Schema.Boolean,
  highlightAll: Schema.Boolean,
  matchDiacritics: Schema.Boolean,
  entireWord: Schema.Boolean,
});

export type FindOptions = Pick<
  FindState,
  "caseSensitive" | "highlightAll" | "matchDiacritics" | "entireWord"
>;

function read<A>(
  host: ReaderHost,
  key: string,
  schema: Schema.Decoder<A>,
): A | null {
  return Option.getOrNull(
    Schema.decodeUnknownOption(schema)(host.storage.get(key)),
  );
}

export function readSidebar(host: ReaderHost): ReaderState["sidebar"] | null {
  return read(host, SIDEBAR_KEY, Sidebar);
}

export function writeSidebar(
  host: ReaderHost,
  sidebar: ReaderState["sidebar"],
): void {
  host.storage.set(SIDEBAR_KEY, { ...sidebar });
}

export function readFindOptions(host: ReaderHost): FindOptions | null {
  return read(host, FIND_KEY, FindOptions);
}

export function writeFindOptions(host: ReaderHost, find: FindOptions): void {
  host.storage.set(FIND_KEY, {
    caseSensitive: find.caseSensitive,
    highlightAll: find.highlightAll,
    matchDiacritics: find.matchDiacritics,
    entireWord: find.entireWord,
  });
}

export function readThemed(host: ReaderHost): boolean {
  return read(host, THEMED_KEY, Schema.Boolean) ?? false;
}

export function writeThemed(host: ReaderHost, themed: boolean): void {
  host.storage.set(THEMED_KEY, themed);
}
