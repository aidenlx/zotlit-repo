// Resolved Zotero paths shared by view reads.
import { Effect, Stream } from "effect";

import { held } from "@/lib/view-atoms.ts";

import { ZoteroPref } from "./service.ts";

export const zoteroDataDirAtom = held(
  Stream.unwrap(
    Effect.map(ZoteroPref, (pref) =>
      Stream.map(pref.changes, (current) => current.dataDir),
    ),
  ),
  "",
);
