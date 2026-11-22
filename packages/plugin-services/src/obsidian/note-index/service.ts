import { Context, Deferred, Effect, Layer, PubSub, Stream } from "effect";
import { TFile } from "obsidian";
import type { CachedMetadata, TAbstractFile } from "obsidian";

import { obsidianEvents } from "@zotlit/obsidian-kit/effect-obsidian-events.ts";
import { MetadataCache } from "@zotlit/obsidian-kit/obsidian-metadata-cache.ts";
import type {
  MetadataCacheShape,
  MetadataEvent,
} from "@zotlit/obsidian-kit/obsidian-metadata-cache.ts";
import { Vault } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import type { VaultEvent } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import { Workspace } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import {
  DEFAULT_PROFILE,
  profileStampOf,
} from "@zotlit/obsidian-kit/profile-stamp.ts";
import type { ProfileSelector } from "@zotlit/obsidian-kit/profile-stamp.ts";
import { NON_VAULT_PROPERTY_KEYS } from "@zotlit/plugin-kernel/constants.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import { filterTag, forkEach } from "@zotlit/plugin-kernel/effect-stream.ts";
import type { LiteratureNoteTarget } from "@zotlit/plugin-kernel/wikilink-citation.ts";
import { heldCitekeyOf } from "@zotlit/zotero-reads/contract/citation-lookup.ts";
import type { CitationLookupAnswer } from "@zotlit/zotero-reads/contract/citation-lookup.ts";

import { literatureNoteOf } from "./literature-note.ts";
import {
  diffContributions,
  EMPTY_CONTRIBUTIONS,
  fileContributions,
  itemKeyFromFrontmatter,
  noteKeyFromFrontmatter,
} from "./parse.ts";
import type { ContribDiff, FileContributions } from "./parse.ts";

export { itemKeyFromFrontmatter, noteKeyFromFrontmatter };
export {
  isLiteratureNote,
  resolveIndexedKey,
  type ResolvedLiteratureNote,
} from "./literature-note.ts";

const UNREAD = Symbol("unread");
interface Read {
  contributions: FileContributions;
  frontmatter: string | null;
}
const NONE: Read = { contributions: EMPTY_CONTRIBUTIONS, frontmatter: null };
type Reading = Read | typeof UNREAD;

export type NoteIndexChange =
  | { readonly type: "indexed" }
  | { readonly type: "changed" | "frontmatter-changed"; readonly file: TFile };

export const resolveLiteratureNoteIn = Effect.fnUntraced(function* (
  metadata: Pick<MetadataCacheShape, "firstLinkpathDest" | "fileCache">,
  linkpath: string,
  sourcePath: string,
) {
  const dest = yield* metadata.firstLinkpathDest(linkpath, sourcePath);
  if (!dest) return null;
  return literatureNoteOf(dest, yield* metadata.fileCache(dest));
});

export const literatureNoteTargetIn = Effect.fnUntraced(function* (
  metadata: Pick<MetadataCacheShape, "firstLinkpathDest" | "fileCache">,
  linkpath: string,
  {
    sourcePath,
    lookup,
  }: {
    readonly sourcePath: string;
    readonly lookup: CitationLookupAnswer | null;
  },
) {
  const note = yield* resolveLiteratureNoteIn(metadata, linkpath, sourcePath);
  if (!note) return null;
  const target: LiteratureNoteTarget = {
    ...note,
    citationKey: heldCitekeyOf(lookup, note.indexedKey) ?? null,
  };
  return target;
});

export class NoteIndex extends Context.Service<
  NoteIndex,
  {
    readonly changes: Stream.Stream<NoteIndexChange>;
    getNotesByItemKey(indexedKey: string): Effect.Effect<TFile[]>;
    getImportedNoteByNoteKey(noteKey: string): Effect.Effect<TFile[]>;
    getNotesByProfile(selector: ProfileSelector): Effect.Effect<{
      literatureNotes: TFile[];
      importedNotes: TFile[];
    }>;
    readonly getPropertyNames: Effect.Effect<string[]>;
    readonly getIndexedItemKeys: Effect.Effect<string[]>;
    readonly whenIndexed: Effect.Effect<void>;
    readonly whenSettled: Effect.Effect<void>;
  }
>()("zotlit/note-index/NoteIndex") {}

declare module "@zotlit/obsidian-kit/view-atoms.ts" {
  interface ViewServiceRegistry {
    NoteIndex: NoteIndex;
  }
}

const makeNoteIndex = Effect.gen(function* () {
  const metadata = yield* MetadataCache;
  const workspace = yield* Workspace;
  const vault = yield* Vault;
  const changes = yield* PubSub.unbounded<NoteIndexChange>();
  yield* Effect.addFinalizer(() => PubSub.shutdown(changes));
  const indexed = yield* Deferred.make<void>();
  const pendingRenames = new Set<Deferred.Deferred<void>>();
  const pendingBarriers = new Set<Deferred.Deferred<void>>();
  const events = yield* obsidianEvents<{
    metadata: [MetadataEvent];
    vault: [Extract<VaultEvent, { _tag: "delete" | "rename" }>];
    "rename-settled": [TFile, Deferred.Deferred<void>];
    layout: [];
    clean: [];
    barrier: [Deferred.Deferred<void>];
  }>();
  const notesByItemKey = new Map<string, Set<TFile>>();
  const notesByNoteKey = new Map<string, Set<TFile>>();
  const contribByFile = new Map<TFile, FileContributions>();
  const frontmatterByFile = new Map<TFile, string>();
  const warnedDuplicatePaths = new Map<string, string>();
  let disposed = false;

  const publish = (change: NoteIndexChange) => PubSub.publish(changes, change);

  const getNotesByItemKey = Effect.fn("NoteIndex.getNotesByItemKey")(function* (
    indexedKey: string,
  ) {
    const notes = sortNotes(notesByItemKey.get(indexedKey));
    if (notes.length > 1) {
      const paths = notes.map((file) => file.path);
      const signature = paths.join("\0");
      if (warnedDuplicatePaths.get(indexedKey) !== signature) {
        warnedDuplicatePaths.set(indexedKey, signature);
        yield* Effect.logWarning(
          "Indexed Key resolves to multiple Literature Notes",
        ).pipe(
          Effect.annotateLogs({ indexedKey, paths }),
          withLogCategory("note-index"),
        );
      }
    } else {
      warnedDuplicatePaths.delete(indexedKey);
    }
    return notes;
  });

  const getImportedNoteByNoteKey = Effect.fn(
    "NoteIndex.getImportedNoteByNoteKey",
  )((noteKey: string) =>
    Effect.sync(() => sortNotes(notesByNoteKey.get(noteKey))),
  );

  const getNotesByProfile = Effect.fn("NoteIndex.getNotesByProfile")(
    (selector: ProfileSelector) =>
      Effect.gen(function* () {
        const literatureNotes: TFile[] = [];
        const importedNotes: TFile[] = [];
        for (const [file, contribution] of contribByFile) {
          const stamp = profileStampOf(yield* metadata.fileCache(file));
          const profile = stamp === undefined ? DEFAULT_PROFILE : stamp.id;
          if (profile !== selector) continue;
          if (contribution.noteKey !== null) importedNotes.push(file);
          else if (contribution.itemKey !== null) literatureNotes.push(file);
        }
        return { literatureNotes, importedNotes };
      }),
  );

  const getPropertyNames = Effect.gen(function* () {
    const names = new Set<string>();
    for (const [file, contribution] of contribByFile) {
      if (contribution.itemKey === null || contribution.noteKey !== null)
        continue;
      const frontmatter = (yield* metadata.fileCache(file))?.frontmatter;
      for (const name of Object.keys(frontmatter ?? {}))
        if (!NON_VAULT_PROPERTY_KEYS.has(name)) names.add(name);
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }).pipe(Effect.withSpan("NoteIndex.getPropertyNames"));

  const getIndexedItemKeys = Effect.sync(() => [...notesByItemKey.keys()]).pipe(
    Effect.withSpan("NoteIndex.getIndexedItemKeys"),
  );

  const whenIndexed = Deferred.await(indexed).pipe(
    Effect.withSpan("NoteIndex.whenIndexed"),
  );

  const whenSettled = Effect.gen(function* () {
    if (disposed) return;
    const barrier = yield* Deferred.make<void>();
    pendingBarriers.add(barrier);
    events.callback("barrier")(barrier);
    yield* Deferred.await(barrier);
    yield* Effect.forEach(
      [...pendingRenames],
      (deferred) => Deferred.await(deferred),
      {
        discard: true,
      },
    );
  }).pipe(Effect.withSpan("NoteIndex.whenSettled"));

  const listen = Effect.fn("NoteIndex.listen")(function* () {
    yield* forkEach(metadata.changes, events.callback("metadata"));
    yield* forkEach(
      filterTag(vault.changes, "delete", "rename"),
      events.callback("vault"),
    );
    yield* workspace.layoutReady.pipe(
      Effect.andThen(Effect.sync(() => events.callback("layout")())),
      Effect.forkScoped({ startImmediately: true }),
    );
    yield* events
      .consume(consume)
      .pipe(Effect.forkScoped({ startImmediately: true }));

    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        disposed = true;
        yield* Deferred.succeed(indexed, undefined);
        for (const settled of pendingRenames)
          yield* Deferred.succeed(settled, undefined);
        pendingRenames.clear();
        for (const barrier of pendingBarriers)
          yield* Deferred.succeed(barrier, undefined);
        pendingBarriers.clear();
      }),
    );
  });

  const scanWhenCacheClean = Effect.fn("NoteIndex.scanWhenCacheClean")(
    function* () {
      if (disposed) return;
      yield* Effect.logDebug(
        "Note index requested a clean metadata cache",
      ).pipe(withLogCategory("note-index"));
      yield* metadata.whenResolved.pipe(
        Effect.andThen(Effect.sync(() => events.callback("clean")())),
        Effect.forkScoped({ startImmediately: true }),
      );
    },
  );

  const consume = Effect.fnUntraced(function* (
    event: Stream.Success<typeof events.stream>,
  ) {
    if (disposed) return;
    switch (event.type) {
      case "metadata": {
        const [change] = event.args;
        if (change._tag === "changed") {
          if (isMarkdownFile(change.file))
            yield* apply(change.file, readCache(change.cache));
        } else if (change._tag === "deleted") yield* apply(change.file, NONE);
        break;
      }
      case "vault": {
        const [change] = event.args;
        const { file } = change;
        if (change._tag === "delete") {
          if (isMarkdownFile(file)) yield* apply(file, NONE);
          break;
        }
        if (!(file instanceof TFile)) break;
        if (!isMarkdownFile(file)) {
          yield* apply(file, NONE);
          break;
        }
        if (contribByFile.has(file)) yield* publish({ type: "changed", file });
        const settled = yield* Deferred.make<void>();
        pendingRenames.add(settled);
        const published = events.callback("rename-settled");
        queueMicrotask(() => published(file, settled));
        break;
      }
      case "rename-settled": {
        const [file, settled] = event.args;
        yield* read(file).pipe(
          Effect.flatMap((reading) => apply(file, reading)),
          Effect.ensuring(
            Effect.gen(function* () {
              pendingRenames.delete(settled);
              yield* Deferred.succeed(settled, undefined);
            }),
          ),
        );
        break;
      }
      case "layout":
        yield* scanWhenCacheClean();
        break;
      case "clean":
        yield* fullScan();
        break;
      case "barrier": {
        const [barrier] = event.args;
        pendingBarriers.delete(barrier);
        yield* Deferred.succeed(barrier, undefined);
        break;
      }
    }
  });

  const read = (file: TFile): Effect.Effect<Reading> =>
    isMarkdownFile(file)
      ? Effect.map(metadata.fileCache(file), (cache) =>
          cache ? readCache(cache) : UNREAD,
        )
      : Effect.succeed(NONE);

  function readCache(cache: CachedMetadata): Read {
    return {
      contributions: fileContributions(cache),
      frontmatter: serializeFrontmatter(cache),
    };
  }

  const apply = Effect.fn("NoteIndex.apply")(function* (
    file: TFile,
    reading: Reading,
  ) {
    const settled = settle(file, reading);
    if (settled.moved) yield* publish({ type: "changed", file });
    if (settled.frontmatter)
      yield* publish({ type: "frontmatter-changed", file });
  });

  function settle(
    file: TFile,
    reading: Reading,
  ): { moved: boolean; frontmatter: boolean } {
    if (reading === UNREAD) return { moved: false, frontmatter: false };
    const prev = contribByFile.get(file) ?? EMPTY_CONTRIBUTIONS;
    const diff = diffContributions(prev, reading.contributions);
    if (!diff.empty) {
      applyDiff(file, diff);
      if (hasContributions(reading.contributions)) {
        contribByFile.set(file, reading.contributions);
      } else {
        contribByFile.delete(file);
      }
    }

    const before = frontmatterByFile.get(file);
    const after = reading.frontmatter;
    const tracked = contribByFile.has(file);
    if (tracked && after !== null) frontmatterByFile.set(file, after);
    else frontmatterByFile.delete(file);
    return {
      moved: !diff.empty,
      frontmatter:
        after !== null && (tracked || before !== undefined) && before !== after,
    };
  }

  const fullScan = Effect.fn("NoteIndex.fullScan")(
    function* () {
      if (disposed) return;
      clear();

      for (const file of yield* vault.getMarkdownFiles) {
        settle(file, yield* read(file));
      }

      yield* Effect.logDebug("Note index scanned").pipe(
        Effect.annotateLogs({ count: contribByFile.size }),
        withLogCategory("note-index"),
      );
      yield* publish({ type: "indexed" });
    },
    Effect.ensuring(Deferred.succeed(indexed, undefined)),
  );

  function applyDiff(file: TFile, diff: ContribDiff): void {
    if (diff.itemKey.remove) {
      removeIndexedFile(notesByItemKey, diff.itemKey.remove, file);
    }
    if (diff.itemKey.add) {
      addIndexedFile(notesByItemKey, diff.itemKey.add, file);
    }

    if (diff.noteKey.remove) {
      removeIndexedFile(notesByNoteKey, diff.noteKey.remove, file);
    }
    if (diff.noteKey.add) {
      addIndexedFile(notesByNoteKey, diff.noteKey.add, file);
    }
  }

  function clear(): void {
    notesByItemKey.clear();
    notesByNoteKey.clear();
    contribByFile.clear();
    frontmatterByFile.clear();
    warnedDuplicatePaths.clear();
  }
  yield* listen();
  return NoteIndex.of({
    changes: Stream.fromPubSub(changes),
    getNotesByItemKey,
    getImportedNoteByNoteKey,
    getNotesByProfile,
    getPropertyNames,
    getIndexedItemKeys,
    whenIndexed,
    whenSettled,
  });
});

export const layerNoteIndex: Layer.Layer<
  NoteIndex,
  never,
  MetadataCache | Vault | Workspace
> = Layer.effect(NoteIndex, makeNoteIndex);

function serializeFrontmatter(cache: CachedMetadata | null): string {
  return JSON.stringify(cache?.frontmatter ?? null);
}

function sortNotes(files: Set<TFile> | undefined): TFile[] {
  if (!files) return [];
  return [...files].sort(
    (a, b) => b.stat.mtime - a.stat.mtime || a.path.localeCompare(b.path),
  );
}

function addIndexedFile(
  index: Map<string, Set<TFile>>,
  key: string,
  file: TFile,
): void {
  ensureSet(index, key).add(file);
}

function removeIndexedFile(
  index: Map<string, Set<TFile>>,
  key: string,
  file: TFile,
): void {
  const files = index.get(key);
  if (!files) return;
  files.delete(file);
  if (files.size === 0) index.delete(key);
}

function ensureSet<T>(index: Map<string, Set<T>>, key: string): Set<T> {
  let values = index.get(key);
  if (!values) {
    values = new Set();
    index.set(key, values);
  }
  return values;
}

function hasContributions(contributions: FileContributions): boolean {
  return contributions.itemKey !== null || contributions.noteKey !== null;
}

function isMarkdownFile(file: TAbstractFile): file is TFile {
  return file instanceof TFile && file.extension === "md";
}
