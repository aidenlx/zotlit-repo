import type {
  CitationOccurrence,
  CitedByGroup,
} from "#obsidian/citation-index/service.ts";
import { Effect, Option, Semaphore, Stream } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import type { PaneType } from "obsidian";

import { MetadataCache } from "@zotlit/obsidian-kit/obsidian-metadata-cache.ts";
import { Vault } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import { Workspace } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import { held, viewRuntime } from "@zotlit/obsidian-kit/view-atoms.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import { filterTag } from "@zotlit/plugin-kernel/effect-stream.ts";

import type { CitedByPreview, SourceFileFacts } from "./store.ts";
import { sourceOutline } from "./store.ts";

import { activeCitedByAtom } from "#obsidian/citation-index/atoms.ts";
import { flashOccurrence } from "#obsidian/citation-index/reveal-occurrence.ts";
import { CitationIndex } from "#obsidian/citation-index/service.ts";

export const revisionsAtom: Atom.Atom<Readonly<Record<string, number>>> = held(
  Stream.unwrap(
    Effect.gen(function* () {
      const metadata = yield* MetadataCache;
      const vault = yield* Vault;
      const touched = Stream.merge(
        Stream.map(filterTag(metadata.changes, "changed"), (event) => [
          event.file.path,
        ]),
        Stream.map(filterTag(vault.changes, "rename", "delete"), (event) =>
          event._tag === "rename"
            ? [event.oldPath, event.file.path]
            : [event.file.path],
        ),
      );
      return Stream.scan(
        touched,
        (): Readonly<Record<string, number>> => ({}),
        (revisions, paths) => ({
          ...revisions,
          ...Object.fromEntries(
            paths.map((path) => [path, (revisions[path] ?? 0) + 1]),
          ),
        }),
      );
    }),
  ),
  {},
);

const revisionAtom = Atom.family((path: string) =>
  Atom.map(revisionsAtom, (revisions) => revisions[path] ?? 0),
);

const LOADING: CitedByPreview = { status: "loading" };
const UNAVAILABLE: CitedByPreview = { status: "unavailable" };

const reads = Semaphore.makeUnsafe(1);

const readPreview = (path: string) =>
  Effect.gen(function* () {
    const vault = yield* Vault;
    const file = yield* vault.getFileByPath(path);
    if (!file) return UNAVAILABLE;
    const index = yield* CitationIndex;
    const facts = yield* reads.withPermits(1)(index.getParsedNote(file));
    const cache = yield* (yield* MetadataCache).fileCache(file);
    return {
      status: "ready",
      facts,
      source: facts.source,
      outline: sourceOutline(cache),
      cache,
    } satisfies CitedByPreview;
  });

export const previewAtom = Atom.family(
  (path: string): Atom.Atom<CitedByPreview> =>
    Atom.map(
      viewRuntime.atom((get) => {
        get(revisionAtom(path));
        return readPreview(path);
      }),
      (result) =>
        AsyncResult.isFailure(result)
          ? UNAVAILABLE
          : Option.getOrElse(AsyncResult.value(result), () => LOADING),
    ),
);

export const activePreviewsAtom: Atom.Atom<
  Readonly<Record<string, CitedByPreview>>
> = Atom.make((get) =>
  Object.fromEntries(
    (get(activeCitedByAtom)?.groups ?? []).map(({ path }) => [
      path,
      get(previewAtom(path)),
    ]),
  ),
);

const sourceFactsAtom = Atom.family(
  (path: string): Atom.Atom<SourceFileFacts | null> =>
    Atom.map(
      viewRuntime.atom((get) => {
        get(revisionAtom(path));
        return Effect.gen(function* () {
          const file = yield* (yield* Vault).getFileByPath(path);
          if (!file) return null;
          const { mtime, ctime } = file.stat;
          return { name: file.basename, mtime, ctime };
        });
      }),
      (result) => Option.getOrNull(AsyncResult.value(result)),
    ),
);

export const activeSourceFactsAtom: Atom.Atom<
  Readonly<Record<string, SourceFileFacts | null>>
> = Atom.make((get) =>
  Object.fromEntries(
    (get(activeCitedByAtom)?.groups ?? []).map(({ path }) => [
      path,
      get(sourceFactsAtom(path)),
    ]),
  ),
);

export const openSourceCommand = viewRuntime.fn(
  (options: { readonly path: string; readonly newLeaf: PaneType | boolean }) =>
    Effect.gen(function* () {
      yield* (yield* Workspace).openLinkText(options.path, "", {
        newLeaf: options.newLeaf,
      });
    }).pipe(
      Effect.tapError((error) =>
        Effect.logWarning("Could not open the citing note", error),
      ),
      withLogCategory("cited-by"),
    ),
);

export const openOccurrenceCommand = viewRuntime.fn(
  (options: {
    readonly group: CitedByGroup;
    readonly occurrence: CitationOccurrence;
    readonly newLeaf: PaneType | boolean;
  }) =>
    Effect.gen(function* () {
      const { group, occurrence, newLeaf } = options;
      const workspace = yield* Workspace;
      const file = yield* (yield* Vault).getFileByPath(group.path);
      const index = yield* CitationIndex;
      const current = file
        ? yield* index.getParsedNote(file).pipe(
            Effect.map((facts) => facts.currentOccurrence(occurrence)),
            Effect.orElseSucceed(() => null),
          )
        : null;
      yield* workspace.openLinkText(group.path, "", { newLeaf });
      if (!current) return;
      const active = yield* workspace.activeMarkdownView;
      const view =
        active?.file?.path === group.path
          ? active
          : (yield* workspace.markdownViews).find(
              (candidate) => candidate.file?.path === group.path,
            );
      if (!view) return;
      yield* workspace.setActiveLeaf(view.leaf, { focus: true });
      yield* Effect.sync(() => flashOccurrence(view, current));
    }).pipe(
      Effect.tapError((error) =>
        Effect.logWarning("Could not open the citing note", error),
      ),
      withLogCategory("cited-by"),
    ),
);
