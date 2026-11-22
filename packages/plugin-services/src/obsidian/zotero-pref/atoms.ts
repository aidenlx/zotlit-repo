import { Effect, Stream } from "effect";

import { held } from "@zotlit/obsidian-kit/view-atoms.ts";

import { ZoteroPref } from "#core/zotero-pref/service.ts";

declare module "@zotlit/obsidian-kit/view-atoms.ts" {
  interface ViewServiceRegistry {
    ZoteroPref: ZoteroPref;
  }
}

export const zoteroDataDirAtom = held(
  Stream.unwrap(
    Effect.map(ZoteroPref, (pref) =>
      Stream.map(pref.changes, (current) => current.dataDir),
    ),
  ),
  "",
);
