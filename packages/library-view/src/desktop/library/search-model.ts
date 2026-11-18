// One Library search's controls, target and interruptible lookup.
import { useAtomValue } from "@effect/atom-react";
import { Effect, Option } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import { createContext, useContext } from "react";

import { viewRuntime } from "@zotlit/obsidian-kit/view-atoms.ts";
import { searchTerms } from "@zotlit/plugin-services/core/item-lookup/search-text.ts";
import { ItemLookup } from "@zotlit/plugin-services/obsidian/item-lookup/service.ts";
import {
  libraryScopeStateAtom,
  resolvedLibraryScopeAtom,
} from "@zotlit/plugin-services/obsidian/library-scope/atoms.ts";
import {
  zoteroRevisionAtom,
  zoteroUnavailableAtom,
} from "@zotlit/zotero-reads/client/atoms.ts";
import type { LibraryScope } from "@zotlit/zotero-reads/contract/library-scope.ts";

import { librariesOf } from "./document.ts";
import type { LibraryNode } from "./document.ts";
import type { SearchFound } from "./search-box.tsx";
import { sameLibrary } from "./tree.ts";

const LIBRARY_SEARCH_LIMIT = 500;
export interface SearchSession {
  readonly text: string;
  readonly everywhere: boolean;
  readonly request: {
    readonly node: LibraryNode;
    readonly scope: LibraryScope;
  } | null;
}
export const patchSearch =
  (patch: Partial<SearchSession>) =>
  (state: SearchSession): SearchSession =>
    Object.entries(patch).every(
      ([key, value]) => state[key as keyof SearchSession] === value,
    )
      ? state
      : { ...state, ...patch };

export function makeSearchModel() {
  const session = Atom.make<SearchSession>({
    text: "",
    everywhere: false,
    request: null,
  });
  const target = Atom.map(session, (state) => state.request);
  const loaded = viewRuntime.atom((get) => {
    const request = get(target);
    const { text, everywhere } = get.once(session);
    const { words } = searchTerms(text);
    if (!request) return Effect.succeed<SearchFound | null>(null);
    if (everywhere || request.node.kind === "recent")
      get(resolvedLibraryScopeAtom);
    if (words !== "") get(zoteroRevisionAtom);
    const readable = !get(zoteroUnavailableAtom);
    const libraryScope = get.once(libraryScopeStateAtom);
    const read = librariesOf(
      request.node,
      request.node.kind === "recent"
        ? libraryScope.current?.available.length
          ? {
              mode: "selected",
              libraries: libraryScope.current.available.map(
                ({ selector }) => selector,
              ),
            }
          : libraryScope.effective
        : request.scope,
    );
    const libraries = everywhere
      ? (libraryScope.current?.available ?? [])
      : (libraryScope.all?.available ?? []).filter(
          ({ selector }) =>
            read.mode === "all" ||
            read.libraries.some((library) => sameLibrary(library, selector)),
        );
    return Effect.gen(function* () {
      const hits =
        words === "" || !readable
          ? null
          : yield* (yield* ItemLookup).search(words, {
              limit: LIBRARY_SEARCH_LIMIT,
              libraries,
            });
      return {
        text,
        ...(hits && { keys: hits.map(({ item }) => item.indexedKey) }),
        ...(everywhere && {
          everywhere: libraries.map(({ selector }) => selector),
        }),
      } satisfies SearchFound;
    });
  });
  const found = Atom.map(loaded, (result) =>
    Option.getOrNull(AsyncResult.value(result)),
  );
  return { session, loaded, found };
}

export type SearchModel = ReturnType<typeof makeSearchModel>;

const SearchModelContext = createContext<SearchModel | null>(null);
export const SearchModelProvider = SearchModelContext.Provider;

export function useSearchState<A>(select: (state: SearchSession) => A): A {
  const model = useContext(SearchModelContext);
  if (!model)
    throw new Error("useSearchState must be used within SearchModelProvider");
  return useAtomValue(model.session, select);
}
