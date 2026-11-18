// Engine status and render revisions shared by bibliography reading surfaces.
import { Effect, Stream } from "effect";
import * as Atom from "effect/reactivity/Atom";

import { held } from "@zotlit/obsidian-kit/view-atoms.ts";

import { BibliographyRender } from "./render-cache.ts";
import { PandocEngine } from "./service.ts";
import type { PandocEngineStatus } from "./service.ts";

export const pandocEngineAtom = held<PandocEngineStatus>(
  Stream.unwrap(Effect.map(PandocEngine, (engine) => engine.changes)),
  { kind: "absent" },
);

export const bibliographyRevisionsAtom = held(
  Stream.unwrap(
    Effect.map(BibliographyRender, (renders) =>
      Stream.scan(
        renders.events,
        (): Readonly<Record<string, number>> => ({}),
        (revisions, event) => {
          const key = event._tag === "invalidated" ? "*" : event.key;
          return { ...revisions, [key]: (revisions[key] ?? 0) + 1 };
        },
      ),
    ),
  ),
  {},
);

/** Global bibliography invalidation, shared by Template Document previews. */
export const bibliographyRevisionAtom = Atom.map(
  bibliographyRevisionsAtom,
  (revisions) => revisions["*"] ?? 0,
);
