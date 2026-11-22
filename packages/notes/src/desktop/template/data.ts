import type { CitationExampleId } from "#core/template-preview/citation-examples.ts";
import type { ExcerptImageContext } from "#core/template/inert-resolvers.ts";
import type { Template } from "#obsidian/template/service.ts";
import { Data, Effect, Stream } from "effect";

import {
  buildAnnotationsTemplateData,
  buildFilenameContext,
  buildNoteContextFromSource,
  citekeysToCiteTemplateData,
  withAnnotationCitation,
} from "@zotlit/db";
import type {
  AnnotationSources,
  CitationTemplateData,
  CitationVariant,
  ContractRoot,
  Item,
  NoteResolvers,
  NoteSource,
} from "@zotlit/db";
import { attachmentFolderPath } from "@zotlit/obsidian-kit/attachment-folder.ts";
import { FileManager } from "@zotlit/obsidian-kit/obsidian-file-manager.ts";
import { Vault } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import { creatorSummary } from "@zotlit/plugin-kernel/item-summary.ts";
import type {} from "@zotlit/plugin-services/core/attachment-import/settings.ts";
import type { Settings } from "@zotlit/plugin-services/core/settings/schema.ts";
import { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import { NoteIndex } from "@zotlit/plugin-services/obsidian/note-index/service.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import { TemplateError } from "@zotlit/templates/facade";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";
import type { ZoteroReadsApi } from "@zotlit/zotero-reads/client/service.ts";

import { annotationCitation } from "./annotation-render.ts";
import {
  buildObsidianInertNoteResolvers,
  findExistingLitNote,
} from "./inert-resolver-host.ts";

import { citationExampleData } from "#core/template-preview/citation-examples.ts";
import { CITATION_TEMPLATE_NAME } from "#core/template/defaults.ts";
import { InertTemplateError } from "#core/template/errors.ts";
import { itemFacets } from "#desktop/note-feature/context.ts";
import { syncTemplate } from "#obsidian/template/sync-template.ts";

export type CitationSelector =
  | { readonly key: string }
  | { readonly example: CitationExampleId };

export type TemplateDataLoadResult =
  | { kind: "data"; data: object }
  | { kind: "not-found" }
  | { kind: "no-parent-item" }
  | { kind: "annotation-required" }
  | { kind: "annotation-attachment-missing" };

export type CitationDataLoadResult =
  | { kind: "data"; data: CitationTemplateData }
  | Exclude<TemplateDataLoadResult, { kind: "data" }>;

export type TemplateDataServices =
  | ZoteroReads
  | NoteIndex
  | PluginSettings
  | Template
  | ZoteroPref
  | Vault
  | FileManager;

export interface TemplateDataLoader {
  load(
    indexedKey: string,
    root: ContractRoot,
    options?: { settings?: Readonly<Settings> },
  ): Promise<TemplateDataLoadResult>;
  loadCitation(
    selector: CitationSelector,
    variant: CitationVariant,
  ): Promise<CitationDataLoadResult>;
}

export interface TemplateDataDeps {
  readonly templateData: TemplateDataLoader;
  readonly dataSettings?: Readonly<Settings>;
}

export class TemplateDataError extends Data.TaggedError("TemplateDataError")<{
  readonly cause: unknown;
}> {}

const failed = (cause: unknown) => new TemplateDataError({ cause });

const query = <A, E>(read: Effect.Effect<A, E>) =>
  Effect.mapError(read, (cause) => failed(cause));

const build = <A>(evaluate: () => A) =>
  Effect.try({ try: evaluate, catch: failed });

const readLease = ZoteroReads.use((reads) =>
  Effect.mapError(reads.snapshot, (cause) => failed(cause)),
);

export const withSelectedNote = (selection: { key: string; path: string }) =>
  Effect.updateService(NoteIndex, (index) => ({
    ...index,
    getNotesByItemKey: (key: string) =>
      key === selection.key
        ? Effect.map(index.getNotesByItemKey(key), (notes) =>
            notes.filter((file) => file.path === selection.path),
          )
        : index.getNotesByItemKey(key),
  }));

export const withSettings = (settings: Readonly<Settings>) =>
  Effect.updateService(PluginSettings, (service) => ({
    ...service,
    current: Effect.succeed(settings),
  }));

export const readTemplateData = Effect.fn("TemplateData.read")(function* (
  indexedKey: string,
  root: ContractRoot,
): Effect.fn.Return<
  TemplateDataLoadResult,
  TemplateDataError,
  TemplateDataServices
> {
  if (root === "citation") {
    return yield* readCitationData({ key: indexedKey }, "main");
  }
  const [settings] = yield* Effect.all(
    [
      PluginSettings.use((service) => service.current),
      NoteIndex.use((index) => index.whenIndexed),
    ],
    { concurrency: "unbounded" },
  );
  if (root === "annotation") {
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const reads = yield* readLease;
        const selected = yield* readAnnotationSources(reads, indexedKey);
        if (selected.kind !== "sources") return selected;
        const { sources, item } = selected;
        const resolvers = yield* createInertResolvers(settings, item);
        const data = yield* build(
          () =>
            buildAnnotationsTemplateData(sources, resolvers.annotation)
              .values()
              .next().value,
        );
        if (!data) return { kind: "not-found" } as const;
        const templates = yield* syncTemplate;
        return {
          kind: "data",
          data: withAnnotationCitation(data, () =>
            renderAnnotationCitation(
              data.parentItem,
              data.pageLabel,
              templates,
            ),
          ),
        } as const;
      }),
    );
  }

  const selected = yield* Effect.scoped(
    Effect.flatMap(readLease, (reads) => readNoteItemSource(reads, indexedKey)),
  );
  if (selected.kind !== "source") return selected;
  const { source } = selected;
  if (root === "filename") {
    const { itemTags, itemCollections } = itemFacets(source);
    return {
      kind: "data",
      data: yield* build(() =>
        buildFilenameContext({
          item: source.item,
          tags: itemTags,
          collections: itemCollections,
          authorsShort: creatorSummary,
        }),
      ),
    };
  }

  const resolvers = yield* createInertResolvers(settings, source.item);

  return {
    kind: "data",
    data: yield* build(() => buildNoteContextFromSource(source, resolvers)),
  };
});

export const readCitationData = Effect.fn("TemplateData.readCitation")(
  function* (
    selector: CitationSelector,
    variant: CitationVariant,
  ): Effect.fn.Return<CitationDataLoadResult, TemplateDataError, ZoteroReads> {
    if ("example" in selector) {
      return {
        kind: "data",
        data: yield* build(() =>
          citationExampleData(selector.example, variant),
        ),
      };
    }
    const selected = yield* Effect.scoped(
      Effect.flatMap(readLease, (reads) => readNoteItem(reads, selector.key)),
    );
    if (selected.kind !== "item") return selected;
    const { item } = selected;
    const citationKey =
      "citationKey" in item.fields ? (item.fields.citationKey ?? null) : null;
    return {
      kind: "data",
      data: yield* build(() =>
        citekeysToCiteTemplateData([{ citationKey, item }], variant),
      ),
    };
  },
);

function renderAnnotationCitation(
  parentItem: Parameters<typeof annotationCitation>[0],
  pageLabel: string | null,
  templates: Parameters<typeof annotationCitation>[2],
): string | null {
  try {
    return annotationCitation(parentItem, pageLabel, templates);
  } catch (error) {
    if (error instanceof InertTemplateError) {
      if (error.templateName !== undefined) throw error;
      throw new InertTemplateError(error.message, CITATION_TEMPLATE_NAME, {
        cause: error,
      });
    }
    if (error instanceof TemplateError) throw error;
    throw new TemplateError(
      error instanceof Error ? error.message : String(error),
      CITATION_TEMPLATE_NAME,
      { cause: error },
    );
  }
}

export const excerptImageContext = (
  settings: Pick<Settings, "attachment.import" | "attachment.folder-path">,
  litNotePath: string | null,
): Effect.Effect<ExcerptImageContext, TemplateDataError, FileManager> => {
  const folderPath = settings["attachment.folder-path"];
  if (!settings["attachment.import"])
    return Effect.succeed({ kind: "file-url" });
  if (!folderPath && litNotePath === null)
    return Effect.succeed({ kind: "not-imported" });
  return attachmentFolderPath(folderPath, litNotePath ?? undefined).pipe(
    Effect.map((folderPath) => ({ kind: "vault" as const, folderPath })),
    Effect.mapError(({ cause }) => failed(cause)),
  );
};

const createInertResolvers = Effect.fnUntraced(function* (
  settings: Readonly<Settings>,
  item: Item | null,
): Effect.fn.Return<
  NoteResolvers,
  TemplateDataError,
  NoteIndex | ZoteroPref | Vault | FileManager
> {
  const index = yield* NoteIndex;
  const vault = yield* Vault;
  const fileManager = yield* FileManager;
  const { dataDir, baseAttachmentPath } = yield* (yield* ZoteroPref).current;
  const context = yield* Effect.context<FileManager>();
  const runSync = Effect.runSyncWith(context);
  const noteIndex = {
    getNotesByItemKey: (key: string) => runSync(index.getNotesByItemKey(key)),
    getImportedNoteByNoteKey: (key: string) =>
      runSync(index.getImportedNoteByNoteKey(key)),
  };
  const litNote = item
    ? yield* build(() =>
        findExistingLitNote(noteIndex, {
          indexedKey: item.indexedKey,
        }),
      )
    : null;
  const litNotePath = litNote?.path ?? null;
  const excerptImages = yield* excerptImageContext(settings, litNotePath);
  return yield* build(() =>
    buildObsidianInertNoteResolvers({
      noteIndex,
      fileManager: {
        generateMarkdownLink: (...[file, sourcePath, subpath, alias]) =>
          runSync(
            fileManager.generateMarkdownLink(file, sourcePath, {
              ...(subpath === undefined ? {} : { subpath }),
              ...(alias === undefined ? {} : { alias }),
            }),
          ),
      },
      vault: { getFileByPath: (path) => runSync(vault.getFileByPath(path)) },
      zoteroPref: { dataDir, baseAttachmentPath },
      sourcePath: litNotePath ?? "",
      excerptImages,
    }),
  );
});

type AnnotationResult =
  | { kind: "sources"; sources: AnnotationSources; item: Item | null }
  | { kind: "not-found" }
  | { kind: "annotation-required" }
  | { kind: "annotation-attachment-missing" };

const readAnnotationSources = Effect.fnUntraced(function* (
  reads: ZoteroReadsApi,
  indexedKey: string,
): Effect.fn.Return<AnnotationResult, TemplateDataError> {
  const selected = yield* query(reads.ItemType({ indexedKey }));
  if (!selected) return { kind: "not-found" };
  if (selected.itemType !== "annotation")
    return { kind: "annotation-required" };
  const sources = yield* query(
    reads.AnnotationSources({
      libraryID: selected.libraryID,
      keys: [selected.key],
    }),
  );
  const [attachment] = sources.attachments;
  if (!attachment) return { kind: "annotation-attachment-missing" };
  const item =
    sources.parentItems.find(
      ({ itemID }) => itemID === attachment.parentItemID,
    ) ?? null;
  return { kind: "sources", sources, item };
});

type NoteItemResult =
  | { kind: "item"; item: Item }
  | { kind: "not-found" }
  | { kind: "no-parent-item" }
  | { kind: "annotation-attachment-missing" };

type NoteItemTarget =
  | {
      kind: "target";
      itemID: number;
      item?: Item;
      missing: "not-found" | "no-parent-item";
    }
  | Exclude<NoteItemResult, { kind: "item" }>;

const resolveNoteItemID = Effect.fnUntraced(function* (
  reads: ZoteroReadsApi,
  indexedKey: string,
): Effect.fn.Return<NoteItemTarget, TemplateDataError> {
  const selected = yield* query(reads.ItemType({ indexedKey }));
  if (!selected) return { kind: "not-found" };
  const { libraryID, key, itemType } = selected;
  let parentItemID: number | null;
  if (itemType === "annotation") {
    const sources = yield* query(
      reads.AnnotationSources({ libraryID, keys: [key], username: null }),
    );
    const attachment = sources.attachments[0];
    if (!attachment) return { kind: "annotation-attachment-missing" };
    parentItemID = attachment.parentItemID;
  } else if (itemType === "attachment") {
    const [attachment] = yield* query(
      reads.AttachmentsByKeys({ libraryID, keys: [key] }),
    );
    if (!attachment) return { kind: "not-found" };
    parentItemID = attachment.parentItemID;
  } else if (itemType === "note") {
    const [note] = yield* query(reads.NoteBodies({ libraryID, keys: [key] }));
    if (!note) return { kind: "not-found" };
    parentItemID = note.parentItemID;
  } else {
    const items = yield* query(
      reads.ItemsByIndexedKeys({ indexedKeys: [indexedKey] }),
    );
    const item = items.values().next().value;
    return item
      ? { kind: "target", itemID: item.itemID, item, missing: "not-found" }
      : { kind: "not-found" };
  }
  if (!parentItemID) return { kind: "no-parent-item" };
  return { kind: "target", itemID: parentItemID, missing: "no-parent-item" };
});

const readNoteItemSource = Effect.fnUntraced(function* (
  reads: ZoteroReadsApi,
  indexedKey: string,
): Effect.fn.Return<
  | { kind: "source"; source: NoteSource }
  | Exclude<NoteItemResult, { kind: "item" }>,
  TemplateDataError
> {
  const target = yield* resolveNoteItemID(reads, indexedKey);
  if (target.kind !== "target") return target;
  const source = yield* query(reads.NoteSource({ itemID: target.itemID }));
  return source ? { kind: "source", source } : { kind: target.missing };
});

const readNoteItem = Effect.fnUntraced(function* (
  reads: ZoteroReadsApi,
  indexedKey: string,
): Effect.fn.Return<NoteItemResult, TemplateDataError> {
  const target = yield* resolveNoteItemID(reads, indexedKey);
  if (target.kind !== "target") return target;
  if (target.item) return { kind: "item", item: target.item };
  const slices = yield* query(
    Stream.runCollect(reads.DisplayRefs({ itemIDs: [target.itemID] })),
  );
  const ref = slices.flat()[0]?.ref ?? null;
  const item =
    ref &&
    (yield* query(
      reads.ItemsByIndexedKeys({ indexedKeys: [ref.indexedKey] }),
    )).get(ref.indexedKey);
  return item ? { kind: "item", item } : { kind: target.missing };
});
