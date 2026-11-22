import type { TemplateAnnotation } from "#lib/context/zt-template-annot.ts";
import type { TemplateAttachment } from "#lib/context/zt-template-attach.ts";
import type {
  FallibleTemplateLink,
  ResolvedItemCore,
  TemplateFilenameItemData,
  TemplateItemBaseData,
  TemplateItemData,
  TemplateItemResolvers,
  TemplateLink,
} from "#lib/context/zt-template-item.ts";
import type { AnnotationFileLinkAnchor } from "#lib/zt-annot-anchor.ts";
import type { Annotation } from "#lib/zt-annot.ts";
import type { Attachment } from "#lib/zt-attach.ts";
import type { TemplateCollection } from "#lib/zt-collection.ts";
import type { ItemTag } from "#lib/zt-tag.ts";
import type { Item } from "#queries/items.ts";
import type { ChildNote } from "#queries/notes.ts";

import { itemSelectUri } from "@zotlit/zotero-types/uri";

import { annotationToTemplateData } from "#lib/context/zt-template-annot.ts";
import { resolveTemplateAttachment } from "#lib/context/zt-template-attach.ts";
import {
  itemToTemplateBaseData,
  resolveItemCore,
  resolvePrimaryCreators,
  withItemPreview,
} from "#lib/context/zt-template-item.ts";
import { defineToString } from "#lib/to-string.ts";

/**
 * A single entry in {@link NoteTemplateContext.relatedItems}: the related
 * item's own fields, flattened with its backlink and author conveniences. Depth-1 — its own `annotations`, `attachments`, and
 * `relatedItems` are deliberately absent (resolving them would require a
 * per-related-item DB fan-out), marking the boundary of the relation graph.
 */
export interface TemplateRelatedItem
  extends TemplateItemData, ResolvedItemCore {}

/**
 * A child note exposed on {@link NoteTemplateContext.notes} as a link only —
 * the imported note's Markdown body lives in its own file, never inlined here.
 * Carries a non-enumerable `toString` rendering its {@link title} (falling back
 * to {@link key}), so it stringifies to a title in string contexts and previews.
 */
export interface TemplateNoteLink {
  /** Bare Zotero key (not scoped). */
  key: string;
  /** {@link key} for the personal library, `KEYgGROUPID` for a group library. */
  indexedKey: string;
  /** Note title as Zotero stores it; `null` when the row carries none. */
  title: string | null;
  /**
   * Renders the link; default alias is the live title. It links the child
   * note's imported note when one exists, and otherwise opens the note in
   * Zotero. Rendering it never imports the child note.
   *
   * @ztFilter note_link
   */
  noteLink: TemplateLink;
}

export function zoteroNoteLink(
  note: Pick<ChildNote, "key" | "groupID" | "title">,
  alias?: string,
): string {
  const label = (alias ?? (note.title || note.key))
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]");
  return `[${label}](${itemSelectUri(note.key, note.groupID)})`;
}

export function withNotePreview(note: TemplateNoteLink): TemplateNoteLink {
  return defineToString(note, function () {
    return this.title ?? this.key;
  });
}

/**
 * The `zt` root for the `note` template: every item field plus the
 * runtime-computed fields assembled at the app layer (backlinks, resolved
 * attachment links, flattened annotations, author conveniences).
 */
export interface NoteTemplateContext
  extends TemplateItemData, ResolvedItemCore {
  /**
   * Flat annotation list across all (or scoped) attachments. Entries carry
   * every annotation property except `citation`, which only a single-annotation
   * render resolves.
   */
  annotations: TemplateAnnotation[];
  /** All attachments for the item. */
  attachments: TemplateAttachment[];
  /**
   * Items from Zotero's "Related" panel (`dc:relation`), sorted by title.
   * Same-library, forward-only, depth-1.
   *
   * @example
   * ```liquid
   * {{ zt.relatedItems | note_links | join: ", " }}
   * ```
   */
  relatedItems: TemplateRelatedItem[];
  /** Imported child notes as link-only entries; `[]` when the item has none. */
  notes: TemplateNoteLink[];
}

export interface AnnotationResolvers {
  filePath: (attachment: Attachment) => string | null;
  fileLink: (
    attachment: Attachment,
    anchor?: AnnotationFileLinkAnchor,
  ) => FallibleTemplateLink;
  annotationImageLink: (annotation: Annotation) => TemplateLink | null;
  commentToMarkdown: (html: string) => string;
  authorsShort: (item: Item) => string;
}

export type NoteContextInput = AnnotationResolvers &
  TemplateItemResolvers & {
    item: Item;
    username: string | null;
    attachments: readonly Attachment[];
    annotationsByAttachment: ReadonlyMap<number, readonly Annotation[]>;
    tagsByItemID: ReadonlyMap<number, readonly ItemTag[]>;
    collectionsByItemID: ReadonlyMap<number, readonly TemplateCollection[]>;
    relatedItems: readonly Item[];
    childNotes?: readonly ChildNote[];
    resolveChildNote?: (note: ChildNote) => TemplateNoteLink;
  };

export function buildFilenameContext(input: {
  item: Item;
  tags: readonly ItemTag[];
  collections: readonly TemplateCollection[];
  authorsShort: (item: Item) => string;
}): TemplateFilenameItemData {
  return toFilenameItemData(
    itemToTemplateBaseData({ item: input.item, tags: input.tags }),
    input.collections,
    input.authorsShort(input.item),
  );
}

function toFilenameItemData(
  baseData: TemplateItemBaseData,
  collections: readonly TemplateCollection[],
  authorsShort: string,
): TemplateFilenameItemData {
  return {
    ...baseData,
    authors: resolvePrimaryCreators(baseData),
    authorsShort,
    notePath: "",
    noteLink: () => "",
    collections,
  };
}

export function buildNoteContext(input: NoteContextInput): NoteTemplateContext {
  const { item } = input;
  const itemResolvers: TemplateItemResolvers = {
    notePath: input.notePath,
    noteLink: input.noteLink,
    authorsShort: input.authorsShort,
  };
  const baseData = itemToTemplateBaseData({
    item,
    tags: input.tagsByItemID.get(item.itemID) ?? [],
  });

  const attachments: TemplateAttachment[] = input.attachments.map((a) =>
    resolveTemplateAttachment(a, input),
  );

  const annotations: TemplateAnnotation[] = [];
  let result: NoteTemplateContext;

  input.attachments.forEach((attachment, i) => {
    const tplAttachment = attachments[i]!;
    const annots = input.annotationsByAttachment.get(attachment.itemID) ?? [];
    for (const annotation of annots) {
      const data = annotationToTemplateData({
        annotation,
        tags: input.tagsByItemID.get(annotation.itemID) ?? [],
        fileLink: (anchor) => input.fileLink(attachment, anchor),
        annotationImageLink: input.annotationImageLink,
        commentToMarkdown: input.commentToMarkdown,
        getParentAttachment: () => tplAttachment,
        getParentItem: () => result,
      });
      annotations.push(data);
    }
  });

  const relatedItems = input.relatedItems
    .map((related) =>
      buildRelatedItem({
        item: related,
        tags: input.tagsByItemID.get(related.itemID) ?? [],
        collections: input.collectionsByItemID.get(related.itemID) ?? [],
        itemResolvers,
        username: input.username,
      }),
    )
    .sort(byTitle);

  const notes = input.resolveChildNote
    ? (input.childNotes ?? []).map(input.resolveChildNote).map(withNotePreview)
    : [];

  const collections = input.collectionsByItemID.get(item.itemID) ?? [];
  const filenameData = toFilenameItemData(
    baseData,
    collections,
    itemResolvers.authorsShort(item),
  );

  result = withItemPreview({
    ...baseData,
    get notePath() {
      return itemResolvers.notePath(filenameData);
    },
    noteLink(alias?: string, subpath?: string) {
      return itemResolvers.noteLink(filenameData, alias, subpath);
    },
    annotations,
    attachments,
    collections,
    ...resolveItemCore({
      item,
      baseData,
      username: input.username,
      authorsShort: itemResolvers.authorsShort,
    }),
    relatedItems,
    notes,
  });
  return result;
}

function buildRelatedItem({
  item,
  tags,
  collections,
  itemResolvers,
  username,
}: {
  item: Item;
  tags: readonly ItemTag[];
  collections: readonly TemplateCollection[];
  itemResolvers: TemplateItemResolvers;
  username: string | null;
}): TemplateRelatedItem {
  const baseData = itemToTemplateBaseData({ item, tags });
  const filenameData = toFilenameItemData(
    baseData,
    collections,
    itemResolvers.authorsShort(item),
  );
  return withItemPreview({
    ...baseData,
    get notePath() {
      return itemResolvers.notePath(filenameData);
    },
    noteLink(alias?: string, subpath?: string) {
      return itemResolvers.noteLink(filenameData, alias, subpath);
    },
    ...resolveItemCore({
      item,
      baseData,
      username,
      authorsShort: itemResolvers.authorsShort,
    }),
    collections,
  });
}

function byTitle(a: TemplateRelatedItem, b: TemplateRelatedItem): number {
  const at = a.title ?? "";
  const bt = b.title ?? "";
  if (!at && !bt) return 0;
  if (!at) return 1;
  if (!bt) return -1;
  return at.localeCompare(bt);
}
