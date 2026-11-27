import { Effect, Stream } from "effect";
import * as Atom from "effect/reactivity/Atom";
import type { TFile } from "obsidian";

import { MetadataCache } from "@zotlit/obsidian-kit/obsidian-metadata-cache.ts";
import { Vault } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import { Workspace } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import { held } from "@zotlit/obsidian-kit/view-atoms.ts";
import { filterTag } from "@zotlit/plugin-kernel/effect-stream.ts";

import { itemKeyFromFrontmatter } from "./parse.ts";
import type { NoteIndexChange } from "./service.ts";
import { NoteIndex } from "./service.ts";

export interface ActiveNote {
  readonly path: string | null;
  readonly key: string | null;
}

const NO_NOTE: ActiveNote = { path: null, key: null };

const sameNote = (a: ActiveNote, b: ActiveNote) =>
  a.path === b.path && a.key === b.key;

export const activeNote: Stream.Stream<
  ActiveNote,
  never,
  MetadataCache | Vault | Workspace
> = Stream.unwrap(
  Effect.gen(function* () {
    const workspace = yield* Workspace;
    const metadata = yield* MetadataCache;
    const vault = yield* Vault;
    const read = Effect.gen(function* () {
      const file = yield* workspace.getActiveFile;
      const cache =
        file?.extension === "md" ? yield* metadata.fileCache(file) : null;
      return { path: file?.path ?? null, key: itemKeyFromFrontmatter(cache) };
    });
    const onDelete = Stream.mapEffect(
      filterTag(vault.changes, "delete"),
      (event) =>
        Effect.map(workspace.getActiveFile, (active) =>
          active === event.file ? Effect.succeed(NO_NOTE) : read,
        ),
    );
    const reads = Stream.mergeAll(
      [
        Stream.make(read),
        Stream.map(
          filterTag(workspace.changes, "file-open", "active-leaf-change"),
          () => read,
        ),
        Stream.map(filterTag(metadata.changes, "changed"), () => read),
        Stream.map(filterTag(vault.changes, "rename"), () => read),
        onDelete,
      ],
      { concurrency: "unbounded" },
    );
    return reads.pipe(
      Stream.mapEffect((next) => next),
      Stream.changesWith(sameNote),
    );
  }),
);

export const activeNoteAtom: Atom.Atom<ActiveNote> = held(activeNote, NO_NOTE);

export const activeKeyAtom: Atom.Atom<string | null> = Atom.map(
  activeNoteAtom,
  (note) => note.key,
);

export const notedItemKeysAtom = held<ReadonlySet<string>>(
  Stream.unwrap(
    Effect.gen(function* () {
      const index = yield* NoteIndex;
      return Stream.concat(
        Stream.make(null),
        index.changes.pipe(
          Stream.filter((change) => change.type !== "frontmatter-changed"),
        ),
      ).pipe(
        Stream.mapEffect(() =>
          Effect.map(index.getIndexedItemKeys, (keys) => new Set(keys)),
        ),
      );
    }),
  ),
  new Set<string>(),
);

export interface NoteIndexSnapshot {
  readonly keys: readonly string[];
  readonly names: readonly string[];
  readonly notes: ReadonlyMap<string, readonly TFile[]>;
  readonly paths: Readonly<Record<string, number>>;
  readonly structureRevision: number;
  readonly change: NoteIndexChange | null;
  readonly ready: boolean;
}

const EMPTY_INDEX_SNAPSHOT: NoteIndexSnapshot = {
  keys: [],
  names: [],
  notes: new Map(),
  paths: {},
  structureRevision: 0,
  change: null,
  ready: false,
};

export const noteIndexSnapshotAtom = held<NoteIndexSnapshot>(
  Stream.unwrap(
    Effect.map(NoteIndex, (index) =>
      Stream.concat(Stream.make(null), index.changes).pipe(
        Stream.mapEffect((change) =>
          Effect.gen(function* () {
            const keys = yield* index.getIndexedItemKeys;
            const names = yield* index.getPropertyNames;
            const notes = new Map<string, readonly TFile[]>();
            for (const key of keys)
              notes.set(key, yield* index.getNotesByItemKey(key));
            return { keys, names, notes, change };
          }),
        ),
        Stream.scan(
          () => EMPTY_INDEX_SNAPSHOT,
          (previous, snapshot): NoteIndexSnapshot => ({
            ...snapshot,
            paths:
              snapshot.change && snapshot.change.type !== "indexed"
                ? {
                    ...previous.paths,
                    [snapshot.change.file.path]:
                      (previous.paths[snapshot.change.file.path] ?? 0) + 1,
                  }
                : previous.paths,
            structureRevision:
              previous.structureRevision +
              (snapshot.change && snapshot.change.type !== "frontmatter-changed"
                ? 1
                : 0),
            ready: true,
          }),
        ),
      ),
    ),
  ),
  EMPTY_INDEX_SNAPSHOT,
);

export const noteIndexStructureRevisionAtom = Atom.map(
  noteIndexSnapshotAtom,
  (snapshot) => snapshot.structureRevision,
);

export const noteSourceAtom = Atom.family((key: string) =>
  held(
    Stream.unwrap(
      Effect.gen(function* () {
        const index = yield* NoteIndex;
        return Stream.concat(Stream.make(null), index.changes).pipe(
          Stream.mapEffect(() =>
            Effect.map(
              index.getNotesByItemKey(key),
              (notes) => notes[0]?.path ?? "",
            ),
          ),
        );
      }),
    ),
    "",
  ),
);
