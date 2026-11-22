import { Effect, Stream } from "effect";
import * as Atom from "effect/reactivity/Atom";

import { held } from "@zotlit/obsidian-kit/view-atoms.ts";

import { changed } from "./events.ts";
import type { ZoteroReadsState } from "./service.ts";
import { ZoteroReads } from "./service.ts";

declare module "@zotlit/obsidian-kit/view-atoms.ts" {
  interface ViewServiceRegistry {
    ZoteroReads: ZoteroReads;
  }
}

export const zoteroRevisionAtom: Atom.Atom<number> = held(
  Stream.unwrap(
    Effect.gen(function* () {
      return Stream.scan(
        changed(yield* ZoteroReads),
        () => 0,
        (revision) => revision + 1,
      );
    }),
  ),
  0,
);

export const zoteroStateAtom: Atom.Atom<ZoteroReadsState> =
  held<ZoteroReadsState>(
    Stream.unwrap(Effect.map(ZoteroReads, (reads) => reads.changes)),
    {
      state: "loading",
      error: null,
      moved: false,
      dbFileMissing: false,
      activeReadMode: null,
    },
  );

export const zoteroUnavailableAtom = Atom.map(
  zoteroStateAtom,
  (state) =>
    state.state === "degraded" || (state.error !== null && state.moved),
);

export const zoteroTreeUnavailableAtom = Atom.map(
  zoteroStateAtom,
  (state) => state.state === "degraded" || state.dbFileMissing,
);

export const zoteroQueryUnavailableRevisionAtom = held(
  Stream.unwrap(
    Effect.map(ZoteroReads, (reads) =>
      reads.events.pipe(
        Stream.filter(
          (event) =>
            event._tag === "degraded" || event._tag === "db-file-missing",
        ),
        Stream.scan(
          () => 0,
          (revision) => revision + 1,
        ),
      ),
    ),
  ),
  0,
);

export const zoteroReadyAtom = Atom.map(
  zoteroStateAtom,
  (state) => state.state === "ready",
);
