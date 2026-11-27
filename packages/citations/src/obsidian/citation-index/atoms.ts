import { Effect, Option, Stream } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";

import { held, viewRuntime } from "@zotlit/obsidian-kit/view-atoms.ts";
import { activeKeyAtom } from "@zotlit/plugin-services/obsidian/note-index/atoms.ts";

import { CitationLookup } from "./lookup-service.ts";
import type { CitedBySnapshot } from "./service.ts";
import { CitationIndex } from "./service.ts";

const citedBy = (key: string) =>
  Stream.unwrap(
    Effect.gen(function* () {
      return (yield* CitationIndex).citedBy(key);
    }),
  );

export const citedByAtom = Atom.family(
  (key: string): Atom.Atom<CitedBySnapshot | null> =>
    Atom.map(viewRuntime.atom(citedBy(key)), (result) =>
      Option.getOrNull(AsyncResult.value(result)),
    ),
);

export const activeCitedByAtom: Atom.Atom<CitedBySnapshot | null> = Atom.make(
  (get) => {
    const key = get(activeKeyAtom);
    return key ? get(citedByAtom(key)) : null;
  },
);

export const citationLookupStateAtom = held(
  Stream.unwrap(Effect.map(CitationLookup, (lookup) => lookup.changes)),
  { status: "pending", revision: null, stopped: false },
);

export const documentRevisionsAtom = held(
  Stream.unwrap(
    Effect.map(CitationIndex, (index) =>
      Stream.scan(
        index.events,
        (): Readonly<Record<string, number>> => ({}),
        (revisions, event) => {
          const path =
            event.type === "changed"
              ? event.path
              : event.type === "membership-changed"
                ? "*"
                : null;
          return path === null
            ? revisions
            : { ...revisions, [path]: (revisions[path] ?? 0) + 1 };
        },
      ),
    ),
  ),
  {},
);
