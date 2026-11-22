import type { ProfileBindingSettings } from "#obsidian/profile/bindings.ts";
import { Effect } from "effect";
import type { TFile } from "obsidian";

import type { PreparedExcerpts } from "@zotlit/annotations/desktop/excerpt-image/prepare.ts";
import { toTemplateCollection } from "@zotlit/db";
import type {
  ItemFacets,
  ItemTag,
  NoteResolvers,
  NoteSource,
  TemplateCollection,
  TemplateFilenameItemData,
} from "@zotlit/db";
import type { AttachmentPathContext } from "@zotlit/db/path";
import { syntheticFile } from "@zotlit/obsidian-desktop/markdown-link.ts";
import type { MarkdownLinker } from "@zotlit/obsidian-kit/obsidian-file-manager.ts";
import { Vault } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import { creatorSummary } from "@zotlit/plugin-kernel/item-summary.ts";
import type { Settings } from "@zotlit/plugin-services/core/settings/schema.ts";
import type { AttachmentImportBatch } from "@zotlit/plugin-services/desktop/attachment-import/service.ts";
import { NoteIndex } from "@zotlit/plugin-services/obsidian/note-index/service.ts";
import { joinNotePath } from "@zotlit/templates";

import { baseNoteName } from "#core/note-feature/filename.ts";
import { buildAnnotationResolvers } from "#desktop/template/annotation-render.ts";
import { childNoteLink } from "#obsidian/note-import/child-note-link.ts";
import { getProfileBinding } from "#obsidian/profile/bindings.ts";
import { Template } from "#obsidian/template/service.ts";

const logged = withLogCategory("note-feature");

export type NoteResolverServices = NoteIndex | Template | Vault;

export type NoteResolverRun = <A, E>(
  effect: Effect.Effect<A, E, NoteResolverServices>,
) => A;

interface NoteTarget {
  path: string;
  file: TFile;
}

export function templateFacets(facets: ItemFacets): {
  itemTags: readonly ItemTag[];
  itemCollections: TemplateCollection[];
} {
  return {
    itemTags: facets.tags,
    itemCollections: facets.collections.map(toTemplateCollection),
  };
}

export function itemFacets(
  source: NoteSource,
): ReturnType<typeof templateFacets> {
  const { itemID } = source.item;
  return templateFacets({
    tags: source.tagsByItemID.get(itemID) ?? [],
    collections: source.collectionsByItemID.get(itemID) ?? [],
  });
}

export function buildNoteResolvers(
  run: NoteResolverRun,
  options: {
    attachmentImport: Pick<AttachmentImportBatch, "decide" | "resolveLink">;
    settings: ProfileBindingSettings | null;
    sourcePath: string;
    zoteroPref: AttachmentPathContext;
    excerptImages?: PreparedExcerpts;
    link: MarkdownLinker;
  },
): NoteResolvers {
  const resolvingFallback = new Set<string>();
  const resolveTarget = (item: TemplateFilenameItemData): NoteTarget =>
    resolveNoteTarget(run, item, {
      settings: options.settings,
      resolvingFallback,
    });
  const failed = (message: string, itemKey: string, error: unknown) =>
    run(
      Effect.logError(message).pipe(
        Effect.annotateLogs({ itemKey, error }),
        logged,
      ),
    );
  const generateMarkdownLink = (
    ...[file, sourcePath, subpath, alias]: [TFile, string, string?, string?]
  ) => options.link(file, sourcePath, { subpath, alias });

  return {
    annotation: buildAnnotationResolvers({
      zoteroPref: options.zoteroPref,
      attachmentImport: options.attachmentImport,
      annotationImageLink: options.excerptImages?.annotationImageLink,
    }),
    item: {
      authorsShort: creatorSummary,
      notePath: (item) => {
        try {
          return resolveTarget(item).path;
        } catch (error) {
          failed(
            "Failed to resolve literature note path",
            item.indexedKey,
            error,
          );
          return null;
        }
      },
      noteLink: (item, alias, subpath) => {
        try {
          const target = resolveTarget(item);
          return generateMarkdownLink(
            target.file,
            options.sourcePath,
            subpath,
            alias,
          );
        } catch (error) {
          failed(
            "Failed to resolve literature note link",
            item.indexedKey,
            error,
          );
          return null;
        }
      },
    },
    resolveChildNote: (note) =>
      childNoteLink(
        {
          importedNote: (noteKey) =>
            run(
              Effect.flatMap(NoteIndex, (noteIndex) =>
                noteIndex.getImportedNoteByNoteKey(noteKey),
              ),
            )[0],
          link: options.link,
        },
        note,
        options.sourcePath,
      ),
  };
}

function resolveNoteTarget(
  run: NoteResolverRun,
  item: TemplateFilenameItemData,
  options: {
    settings: Readonly<Settings> | null;
    resolvingFallback: Set<string>;
  },
): NoteTarget {
  const byItemKey = run(
    Effect.flatMap(NoteIndex, (noteIndex) =>
      noteIndex.getNotesByItemKey(item.indexedKey),
    ),
  )[0];
  if (byItemKey) return { path: byItemKey.path, file: byItemKey };

  const { settings, resolvingFallback } = options;
  if (settings === null) {
    throw new Error("Settings are not loaded");
  }

  if (resolvingFallback.has(item.indexedKey)) {
    throw new Error("Recursive literature note path resolution");
  }
  resolvingFallback.add(item.indexedKey);
  try {
    const folderSetting = getProfileBinding(settings, "note.literature-folder");
    const rel = baseNoteName(
      run(
        Effect.flatMap(Template, (template) => template.renderFilename(item)),
      ),
    );
    const path = joinNotePath(folderSetting, rel);
    if (
      run(Effect.flatMap(Vault, (vault) => vault.getAbstractFileByPath(path)))
    ) {
      throw new Error(
        `Cannot resolve a synthetic note path: ${path} is occupied by another note`,
      );
    }
    return { path, file: syntheticFile(path) };
  } finally {
    resolvingFallback.delete(item.indexedKey);
  }
}
