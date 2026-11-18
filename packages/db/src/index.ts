export type { ZoteroDatabase } from "./client/database.ts";
export {
  getLibraries,
  getLibraryByGroupID,
  type Library,
} from "./queries/libraries.ts";
export { type GroupIDMemo } from "./queries/libraries.ts";
export {
  getItemsByID,
  getItemTypeByKey,
  getItemsByLibrary,
  getItemsByKey,
  isChildItemFields,
  type BaseItem,
  type ChildItemFields,
  type Creator,
  type Item,
} from "./queries/items.ts";
export {
  itemBaseFields,
  resolveVenue,
  type ItemBaseFields,
} from "./lib/zt-venue.ts";
export {
  itemToCsl,
  type CslDate,
  type CslItemData,
  type CslName,
} from "./lib/zt-csl-item.ts";
export {
  getAccountUserID,
  getZoteroDatabaseIdentity,
  getZoteroIdentity,
  type ZoteroDatabaseIdentity,
  type ZoteroUserIdentity,
} from "./queries/account.ts";
export {
  NotZoteroDatabaseError,
  readDatabaseLayout,
  type DatabaseLayout,
  type LayoutGap,
  type LayoutVersions,
} from "./layout/index.ts";
export {
  getSchemaVersions,
  SUPPORTED_SCHEMA_VERSIONS,
  type ZoteroSchemaVersions,
} from "./queries/schema-version.ts";
export {
  getItemDisplayInfoByID,
  getItemDisplayRefByID,
  getItemDisplayRefsByIDs,
  getItemRefByID,
  type ItemDisplayInfo,
  type ItemRef,
} from "./queries/item-ref.ts";
export {
  ANNOTATION_ANCHOR_KEY,
  ATTACHMENT_ANCHOR_KEY,
  formatAnnotationFragment,
  formatAnnotationSubpath,
  parseAnnotationSubpath,
  type AnnotationFileLinkAnchor,
  type ParsedAnnotationSubpath,
} from "./lib/zt-annot-anchor.ts";
export {
  resolveIndexedKeyLibrary,
  resolveIndexedKeyLibraryIn,
} from "./lib/zt-key.ts";
export { USER_LIBRARY_ID } from "./lib/constants.ts";
export {
  getAnnotationsByKey,
  getAnnotationParentKeys,
  getAnnotationsByParent,
} from "./queries/annotations.ts";
export {
  getAttachmentByItemId,
  getAttachmentPage,
  getAttachmentByKey,
  getAttachmentsByKey,
  getAttachmentsByParents,
  type AttachmentWithParentKey,
} from "./queries/attachments.ts";
export {
  getChildNotesByParentIDs,
  getNoteByKey,
  getNotesByKey,
  getNoteRefsByItemIDs,
  type ChildNote,
  type Note,
  type NoteRef,
} from "./queries/notes.ts";
export {
  getCitekeyByItemKey,
  getCitekeyWindow,
  getLastItemID,
  getCitekeysByLibrary,
  getItemIDByCitekey,
  type LibraryCitekey,
  type CitekeyRow,
} from "./queries/citekey.ts";
export {
  getAllTagNames,
  getLibraryTagNames,
  resolveItemTags,
  type TagMemo,
} from "./queries/tags.ts";
export { getRelatedKeysByItemID } from "./queries/item-relations.ts";
export {
  CollectionCache,
  toTemplateCollection,
  type TemplateCollection,
} from "./lib/zt-collection.ts";
export {
  getCollectionIDsByItem,
  getCollectionNodesByLibrary,
  type CollectionNode,
} from "./queries/collections.ts";
export {
  getAttachmentAnnotationCount,
  getAnnotViewAttachments,
  type AnnotViewAttachment,
} from "./queries/annot-view.ts";
export {
  type ItemTag,
  type TagType,
  type TemplateTag,
  tagTypeToName,
} from "./lib/zt-tag.ts";
export { type Attachment, linkModeToName } from "./lib/zt-attach.ts";
export {
  type CreatorFieldMode,
  creatorFieldModeToName,
} from "./lib/zt-creator.ts";
export {
  getCollectionIDByKey,
  getIndexedItemIDsByCollection,
  getNoteItemIDsByCollection,
  getNoteItemIDsByLibrary,
} from "./queries/batch-scope.ts";
export {
  getIndexedItemIDsByLibrary,
  getIndexedItemRowsRange,
  getIndexedItemsByID,
  getIndexedItemCount,
  getIndexSignatureRange,
  getItemIDBounds,
  sumSignatureRanges,
  type IndexedCreator,
  type IndexedItem,
  type IndexedItemScanRow,
  type IndexSignature,
} from "./queries/index-items.ts";
export { formatItemDate, parseItemDate, type ItemDate } from "./lib/zt-date.ts";
export {
  parseItemExtra,
  type ExtraLine,
  type ItemExtra,
} from "./lib/zt-extra.ts";
export { isPageNumber } from "./lib/zt-page-label.ts";
export {
  annotationHasCacheImage,
  annotationTypeToName,
  type Annotation,
  type AnnotationType,
  type ResolvedAnnotationTypeName,
} from "./lib/zt-annot.ts";
export { type AnnotationPositionRaw } from "#drizzle/schema.ts";
export {
  parseAnnotationPosition,
  type AnnotationPosition,
  type PdfInkPosition,
  type PdfRectsPosition,
  type PdfTextPosition,
} from "./lib/zt-annot-pos.ts";
export {
  withAnnotationCitation,
  type AnnotationTemplateContext,
  type TemplateAnnotation,
} from "./lib/context/zt-template-annot.ts";
export {
  creatorTypePriority,
  type FallibleTemplateLink,
  type TemplateAuthorData,
  type TemplateFilenameItemData,
  type TemplateItemData,
  type TemplateLink,
  type TemplateParentItemData,
} from "./lib/context/zt-template-item.ts";
export {
  CITATION_VARIANTS,
  citekeysToCiteTemplateData,
  DEFAULT_CITATION_VARIANT,
  DEFAULT_LOCATOR_LABEL_SHORT,
  isCitationVariant,
  narrowBaseDataToCiteItemData,
  resolveCitedItem,
  type CitationTemplateData,
  type CitationVariant,
  type CiteRef,
  type ResolvedCiteRef,
  type TemplateCiteItemData,
} from "./lib/context/zt-template-cite.ts";
export { attachmentToTemplateData } from "./lib/context/zt-template-attach.ts";
export {
  annotationColorToName,
  annotationColorsForName,
  type AnnotationColorName,
  highlightColorToName,
  textColorToName,
} from "./lib/zt-color.ts";
export {
  createLanguageLookup,
  parseItemLanguage,
  type ItemLanguage,
  type LanguageNameLookup,
} from "./lib/zt-lang.ts";
export {
  parseAnnotationData,
  parseCitationData,
  parseEmbeddedCitationItems,
  parseEmbeddedCitationSnapshot,
  type AnnotationInfo,
  type CitationInfo,
  type CitationItem,
  type ZoteroRef,
} from "./lib/zt-note-mark.ts";
export {
  buildFilenameContext,
  zoteroNoteLink,
  type NoteTemplateContext,
  type TemplateNoteLink,
} from "./lib/context/zt-template-note.ts";
export {
  buildAnnotationParents,
  buildAnnotationsTemplateData,
  buildNoteContextFromSource,
  fetchAnnotationSources,
  fetchAnnotationsTemplateData,
  fetchAttachmentSources,
  fetchNoteContext,
  fetchItemFacets,
  fetchNoteSource,
  type AnnotationParent,
  type AnnotationResolvers,
  type AnnotationSources,
  type ItemFacets,
  type NoteResolvers,
  type NoteSource,
} from "./lib/context/note-context.ts";
export {
  CONTRACT_ROOTS,
  CONTRACT_VERSION,
  TEMPLATE_SLOT_ROOTS,
  templateSlotsForRoot,
  type ContractRoot,
  type TemplateSlot,
} from "./contract/roots.ts";
