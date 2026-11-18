export { ANNOTATION_HEADER } from "@zotlit/templates/constants";

export { workbenchDocumentAtoms } from "./atoms.ts";
export type { WorkbenchDocumentAtoms } from "./atoms.ts";
export {
  entryPosition,
  entrySlice,
  externalEdit,
  sliceEdit,
  WorkbenchDocumentController,
} from "./controller.ts";
export type {
  WorkbenchAnnotationSection,
  WorkbenchDocumentKind,
  WorkbenchEntrySliceId,
  WorkbenchProblem,
  WorkbenchProblemCode,
  WorkbenchSliceEditor,
  WorkbenchSliceId,
  WorkbenchSliceRange,
  WorkbenchUpdate,
} from "./controller.ts";
export {
  followEntries,
  managedEntryEdit,
  managedFrontmatterEntries,
  manifestKeyEdit,
  manifestNodeRange,
  manifestScalarSlice,
  manifestValueEdit,
} from "./manifest-patch.ts";
export type {
  ManagedEntryAction,
  ManagedEntryLanguage,
  ManagedEntrySource,
  ManagedFrontmatterList,
  ManifestScalar,
  ManifestScalarSlice,
} from "./manifest-patch.ts";
export { noteRegions, partialCalls, templateCalls } from "./regions.ts";
export type {
  AnnotationRenderSite,
  ManagedBlockRegion,
  NoteRegions,
  PartialRenderSite,
} from "./regions.ts";
export { sliceOffsets, sliceShownText, workbenchSlice } from "./slice.ts";
export { jsonCodec, scalarCodec, sourceCodec } from "./slice-codec.ts";
export type { SliceCodec } from "./slice-codec.ts";

export { jsonLayout, jsonPosition } from "./json-source.ts";
