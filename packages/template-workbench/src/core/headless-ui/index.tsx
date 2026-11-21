export { MatchEditor, MatchPane } from "./match.tsx";
export { MatchExpressionInput } from "./match.expression.tsx";
export { filterVocabulary } from "./match.fields.tsx";
export type { FilterValues } from "./match.fields.tsx";
export { isDatasetFieldKind } from "#core/filter-fields/fields.ts";
export type { FilterField } from "#core/filter-fields/fields.ts";
export type { MatchFilter } from "./match.tsx";
// The Workbench UI: the headless component tree the Template Workbench View
// mounts over one Template Document (ADR 0044). It renders structure and behaviour; the host supplies the look
// through `WorkbenchThemeProvider` and its popups through
// `WorkbenchHostProvider`, and each editor instance keeps its view state in
// the Workbench model `WorkbenchEditorProvider` puts in context: the
// document controller in use, the reader's choices, and the one Render
// Scheduler its result surfaces share.

export { WorkbenchMessagesProvider } from "./messages.tsx";

export { createWorkbenchEditor, WorkbenchEditorProvider } from "./editor.tsx";
export type { WorkbenchEditorInstance } from "./editor.tsx";
export {
  chooseAnnotation,
  chooseCitation,
  chooseItem,
  choosePartialProfile,
  INITIAL_CHOICES,
  INITIAL_VIEW,
  patchAt,
  pressFieldsAction,
  setAdvanced,
  setPreview,
  setRoot,
  setTab,
} from "./model.ts";
export type {
  TemplateRoot,
  WorkbenchChoices,
  WorkbenchItemChoice,
  WorkbenchItemData,
  WorkbenchItemDataInput,
  WorkbenchModel,
  WorkbenchPreviewSettings,
  WorkbenchViewState,
} from "./model.ts";
export {
  savedPanelWidth,
  clampPreviewHeight,
  INITIAL_PANELS,
  setPanelWidth,
  setPreviewHeight,
  showPreview,
} from "./panel-layout.ts";
export type {
  FieldsDock,
  ViewSize,
  WorkbenchPanel,
  WorkbenchPanels,
} from "./panel-layout.ts";
export { HELP_PAGES } from "./help-pages.ts";
export { ItemRow } from "./item-row.tsx";
export { SidePanels } from "./panels.tsx";
export { fieldsActionAttributes } from "./fields-panel.tsx";
export {
  NO_MATCH_DATA,
  WorkbenchClipboardError,
  WorkbenchHostError,
  WorkbenchHostProvider,
  useWorkbenchHost,
} from "./host.tsx";
export type { WorkbenchRunner } from "#core/language/host-effects.ts";
export type {
  WorkbenchDialogRequest,
  WorkbenchFieldsAction,
  WorkbenchFieldDetailsProps,
  WorkbenchFieldsPopoverProps,
  WorkbenchHost,
  WorkbenchInsertTarget,
  WorkbenchInputSuggestionsRequest,
  WorkbenchLibrary,
  WorkbenchMatchResult,
  WorkbenchMenuItem,
  WorkbenchSuggesterOption,
  WorkbenchSuggesterRequest,
} from "./host.tsx";
export {
  diagnosticText,
  renderDiagnosis,
  workbenchDiagnoses,
} from "./problems.ts";
export { ProblemsFooter, useWorkbenchProblems } from "./problems-footer.tsx";
export {
  citationExampleLabel,
  citationVariantLabel,
} from "./citation-preview.ts";
export { partialContextLabel } from "./partial-preview.ts";
export { TabBar, TabPanel } from "./tab-bar.tsx";
export { TABS, tabsFor } from "./tabs.ts";
export { insertionTarget, repairCommands } from "./repair-commands.ts";
export { WorkbenchThemeProvider, useParts } from "./theme.tsx";
export type { WorkbenchIcon, WorkbenchTheme } from "./theme.tsx";

export { NotePane } from "./note-pane.tsx";
export { usePartialBoxes } from "./partial-boxes.tsx";
export type { PartialPlaceholderHost } from "./partial-boxes.tsx";
export { SliceEditor } from "./slice-editor.tsx";
export type { WorkbenchMarkdownProps } from "./host.tsx";

export {
  PreviewFilenameLabel,
  previewFilename,
  ResultBody,
} from "./result-column.tsx";
export type { ResultMode } from "./result-column.tsx";
export { PropertyList } from "./property-list.tsx";

export { NameFolderPane, BUILT_IN_BINDING_DEFAULTS } from "./name-folder.tsx";
export type { NameFolderPaneProps } from "./name-folder.tsx";
export { entryDiagnostics, PropertiesPane } from "./properties-tab.tsx";
export {
  AnnotationPane,
  AnnotationSampleBar,
  annotationOption,
  AnnotationSectionBar,
} from "./annotation.tsx";
export { annotationSamples } from "./annotation-samples.ts";

export { fieldForm } from "./field-insertion.ts";
export type {
  FieldInsertionContext,
  FieldInsertOptions,
} from "./field-insertion.ts";
export { explorerSectionIds, visibleSectionIds } from "./explorer-sections.ts";
export { DataExplorer } from "./data-explorer.tsx";
export type {
  DataExplorerProps,
  ExplorerPresentation,
} from "./data-explorer.tsx";

export { WorkbenchDiagnosticsProvider } from "./source-diagnostics.tsx";
