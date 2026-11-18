// The Profile-managed keys of one Literature Note, shared by every table cell.
import { Effect } from "effect";
import * as Atom from "effect/reactivity/Atom";

import { NoteFeature } from "@zotlit/notes/desktop/note-feature/service.ts";
import { profileRevisionAtom } from "@zotlit/notes/obsidian/profile/atoms.ts";
import { templateRevisionAtom } from "@zotlit/notes/obsidian/template/atoms.ts";
import { Vault } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import { viewRuntime } from "@zotlit/obsidian-kit/view-atoms.ts";
import {
  noteIndexSnapshotAtom,
  noteIndexStructureRevisionAtom,
} from "@zotlit/plugin-services/obsidian/note-index/atoms.ts";

const noteRevisionAtom = Atom.family((path: string) =>
  Atom.map(noteIndexSnapshotAtom, (snapshot) => snapshot.paths[path] ?? 0),
);

/** Keyed by path: a family hashes an object key by structure, and a TFile links back to itself. */
export const replacedKeysAtom = Atom.family((path: string) =>
  viewRuntime.atom((get) => {
    get(noteRevisionAtom(path));
    get(noteIndexStructureRevisionAtom);
    get(profileRevisionAtom);
    get(templateRevisionAtom);
    return Effect.gen(function* () {
      const file = yield* (yield* Vault).getFileByPath(path);
      if (!file) return new Set<string>();
      return yield* (yield* NoteFeature).replacedKeys(file);
    });
  }),
);
