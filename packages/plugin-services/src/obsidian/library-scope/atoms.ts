import { Effect, Stream } from "effect";
import * as Atom from "effect/reactivity/Atom";

import { held } from "@zotlit/obsidian-kit/view-atoms.ts";
import { DEFAULT_LIBRARY_SCOPE } from "@zotlit/zotero-reads/contract/library-scope.ts";

import type { LibraryScopeState } from "./service.ts";
import { LibraryScope } from "./service.ts";

export const libraryScopeStateAtom = held<LibraryScopeState>(
  Stream.unwrap(Effect.map(LibraryScope, (scope) => scope.changes)),
  {
    current: null,
    all: null,
    invalid: false,
    effective: DEFAULT_LIBRARY_SCOPE,
    libraryRows: null,
  },
);
export const resolvedLibraryScopeAtom = Atom.map(
  libraryScopeStateAtom,
  (state) => state.current,
);
export const availableLibrariesAtom = Atom.map(
  libraryScopeStateAtom,
  (state) => state.all?.available ?? [],
);

export const libraryAvailabilityRevisionAtom = held(
  Stream.unwrap(
    Effect.map(LibraryScope, (scope) =>
      scope.changes.pipe(
        Stream.map((state) => state.all),
        Stream.changes,
        Stream.drop(1),
        Stream.scan(
          () => 0,
          (revision) => revision + 1,
        ),
      ),
    ),
  ),
  0,
);

export const libraryRowsAtom = Atom.map(
  libraryScopeStateAtom,
  (state) => state.libraryRows,
);
