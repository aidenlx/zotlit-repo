export { NoteFeature } from "./service.ts";
export { bindNoteFeature } from "./handle.ts";
export {
  applyComposedFrontmatter,
  composeLiteratureNote,
  prepareLiteratureNote,
  type ComposedNote,
  type ComposeFrontmatterInput,
  type ComposeNoteDeps,
  type ComposeNoteInput,
  type ComposeProfile,
  type ComposeRefusal,
  type PreparedComposition,
} from "./compose.ts";
export { openCompanionNote, companionNoteNotice } from "./companion-view.ts";
export { noteOperationDiagnosticContent } from "./update-single.ts";
export {
  awaitProfileSwitchConsent,
  switchNoteProfileInteractively,
  type ProfileSwitchConsent,
} from "./switch-view.ts";
export {
  type InteractiveCreationOptions,
  type InteractiveCreationPorts,
} from "./creation-view.ts";
export {
  type CompanionNoteTarget,
  type CreateNoteDiagnostic,
  type CreateNoteResult,
  type CreationProfileSources,
  type CreationProfileSelection,
  type CreationProfileSource,
  type CreationSelectionProblem,
  type ProfileNotePreview,
  type ProfilePreview,
  type NoteFeatureHandle,
  type UpdateResult,
  type UpdateScope,
} from "./operations.ts";
export {
  type ProfileNotePreviewOptions,
  type PreparedProfileSwitch,
} from "./types.ts";
