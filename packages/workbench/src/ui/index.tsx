export { useCustomFieldNames } from "./custom-fields.ts";
export { MatchEditor, MatchPane } from "./match.tsx";
export { MatchExpressionInput } from "./match.expression.tsx";
export type { ExpressionVocabulary } from "#language/filter-expression-completion.ts";
export { filterVocabulary } from "./match.fields.tsx";
export type { FilterValues } from "./match.fields.tsx";
export { isDatasetFieldKind } from "#match/fields.ts";
export type { FilterField } from "#match/fields.ts";
export { ChipInput } from "./match.chips.tsx";
export { MatchInput } from "./match.input.tsx";
export { MatchSelect } from "./match.rows.tsx";
export type { MatchSelectOption, MatchSelectProps } from "./theme.tsx";
export type {
  ConditionControlProps,
  ConditionPath,
  ExpressionCondition,
  LabelledRow,
  MatchConditionKind,
  MatchFilter,
  MatchVocabulary,
  RowCondition,
} from "./match.tsx";
// The Workbench UI: the headless component tree both the web Template
// Workbench and the Obsidian Template Workbench View mount over one Template
// Document
// (ADR 0044). It renders structure and behaviour; the host supplies the look
// through `WorkbenchThemeProvider` and its popups through
// `WorkbenchHostProvider`, and each editor instance keeps its view state in
// the Workbench model `WorkbenchEditorProvider` puts in context: the
// document controller in use, the reader's choices, and the one Render
// Scheduler its result surfaces share.

export {
  WorkbenchMessagesProvider,
  useWorkbenchMessages,
} from "./messages.tsx";
export type { WorkbenchMessages } from "./generated/messages.ts";

export { EditToolbar } from "./edit-toolbar.tsx";
export {
  createWorkbenchEditor,
  WorkbenchEditorProvider,
  useOptionalEditor,
  useWorkbenchController,
  useWorkbenchEditor,
  useWorkbenchModel,
} from "./editor.tsx";
export type { WorkbenchEditor, WorkbenchEditorInstance } from "./editor.tsx";
export {
  chooseAnnotation,
  chooseCitation,
  chooseItem,
  choosePartialProfile,
  INITIAL_CHOICES,
  INITIAL_VIEW,
  makeWorkbenchModel,
  patch,
  patchAt,
  pressFieldsAction,
  setAdvanced,
  setPreview,
  setRoot,
  setTab,
} from "./model.ts";
export type {
  ChooseJob,
  CopyJob,
  CreatePartialJob,
  PreviewMode,
  PreviewSettings,
  TemplateRoot,
  WorkbenchChoices,
  WorkbenchItemChoice,
  WorkbenchItemData,
  WorkbenchItemDataInput,
  WorkbenchModel,
  WorkbenchModelOptions,
  WorkbenchMatchVocabulary,
  WorkbenchPreviewSettings,
  WorkbenchRuntime,
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
  PanelSide,
  PreviewPanel,
  ViewSize,
  WorkbenchPanel,
  WorkbenchPanels,
} from "./panel-layout.ts";
export { panelSizeMenus, pickPanelSize } from "./panel-menu.ts";
export { HELP_PAGES } from "./help-pages.ts";
export { ItemRow } from "./item-row.tsx";
export { SidePanels } from "./panels.tsx";
export { fieldsActionAttributes } from "./fields-panel.tsx";
export {
  NO_MATCH_DATA,
  WorkbenchClipboardError,
  WorkbenchHostError,
  WorkbenchHostProvider,
  useTooltip,
  useWorkbenchHost,
} from "./host.tsx";
export type { WorkbenchRunner } from "#language/host-effects.ts";
export type {
  WorkbenchConfirmRequest,
  WorkbenchDialogHandle,
  WorkbenchDialogRequest,
  WorkbenchFieldsAction,
  WorkbenchFieldDetailsProps,
  WorkbenchFieldsPopoverProps,
  WorkbenchHost,
  WorkbenchInsertTarget,
  WorkbenchInputSuggestionsRequest,
  WorkbenchLibrary,
  WorkbenchMatchData,
  WorkbenchMatchResult,
  WorkbenchMenuItem,
  WorkbenchMenuRequest,
  WorkbenchPersistence,
  WorkbenchPreferenceScope,
  WorkbenchSuggesterGroup,
  WorkbenchSuggesterOption,
  WorkbenchSuggesterRequest,
} from "./host.tsx";
export {
  diagnosisEngineSources,
  diagnosisExplanation,
  diagnosisLabel,
  diagnosisReport,
  diagnosisWhere,
  diagnosticText,
  documentDiagnosis,
  problemText,
  renderDiagnosis,
  diagnosisForOccurrence,
  workbenchDiagnoses,
} from "./problems.ts";
export type {
  DiagnosisExplanation,
  ProblemText,
  WorkbenchDiagnosis,
} from "./problems.ts";
export {
  ProblemsFooter,
  problemWhere,
  useWorkbenchProblems,
} from "./problems-footer.tsx";
export type {
  WorkbenchProblemCapture,
  WorkbenchProblemsState,
} from "./problems-footer.tsx";
export { makeRenderSchedulerAtoms } from "./scheduler-atoms.ts";
export type {
  RenderSchedulerAtoms,
  RenderSchedulerAtomsOptions,
  RenderSchedulerInput,
  RenderSchedulerState,
  RenderTrigger,
} from "./scheduler-atoms.ts";
export {
  citationExampleLabel,
  citationVariantLabel,
} from "./citation-preview.ts";
export { partialContextLabel } from "./partial-preview.ts";
export { TabBar, TabPanel } from "./tab-bar.tsx";
export { isProfileProblem, TABS, tabLabel, tabLede, tabsFor } from "./tabs.ts";
export { routeDiagnosis, routeProblem } from "./problem-route.ts";
export {
  insertionTarget,
  repairCommands,
  selectionInDocument,
} from "./repair-commands.ts";
export type { WorkbenchTab } from "./tabs.ts";
export {
  WorkbenchThemeProvider,
  useIcon,
  usePanelProperties,
  useParts,
} from "./theme.tsx";
export type {
  PartAttributes,
  WorkbenchClassMap,
  WorkbenchComponent,
  WorkbenchIcon,
  WorkbenchParts,
  WorkbenchTheme,
} from "./theme.tsx";

export { NotePane } from "./note-pane.tsx";
export type { NotePaneProps } from "./note-pane.tsx";
export { usePartialBoxes } from "./partial-boxes.tsx";
export type { PartialBoxes, PartialPlaceholderHost } from "./partial-boxes.tsx";
export { SliceEditor } from "./slice-editor.tsx";
export type {
  SliceEditorProps,
  SliceLanguage,
  SuggestionSource,
} from "./slice-editor.tsx";
export { useOptionalHost } from "./host.tsx";
export type { WorkbenchMarkdownProps } from "./host.tsx";

export { COMMON_FIELDS, completionFields } from "./completion-fields.ts";
export type { CommonField } from "./completion-fields.ts";
export { tagDescription } from "./tag-help.ts";
export {
  PreviewFilenameLabel,
  previewFilename,
  ResultBody,
  ResultColumn,
  ResultHeader,
  ResultRegion,
} from "./result-column.tsx";
export type {
  ResultBodyProps,
  ResultColumnProps,
  ResultMode,
} from "./result-column.tsx";
export {
  PropertyList,
  PropertyValue,
  propertyText,
  propertyType,
} from "./property-list.tsx";
export type { PropertyType } from "./property-list.tsx";

export { PreviewControls } from "./preview-controls.tsx";

export { NameFolderPane, BUILT_IN_BINDING_DEFAULTS } from "./name-folder.tsx";
export type { NameFolderPaneProps } from "./name-folder.tsx";
export { entryDiagnostics, PropertiesPane } from "./properties-tab.tsx";
export type {
  EntryDiagnostic,
  PropertiesPaneProps,
} from "./properties-tab.tsx";
export {
  AnnotationPane,
  AnnotationSampleBar,
  annotationOption,
  AnnotationSectionBar,
} from "./annotation.tsx";
export { annotationSamples } from "./annotation-samples.ts";
export type { AnnotationExamples } from "./annotation-samples.ts";
export { SampleSuggester } from "./sample-suggester.tsx";
export type { SampleOption } from "./sample-suggester.tsx";

export { DisplayTree } from "./explorer-tree.tsx";
export type { DisplaySection, DisplayTreeProps } from "./explorer-tree.tsx";
export { commonRows, fieldValueText, rowMatches } from "./explorer-fields.ts";
export { fieldForm, fieldForms } from "./field-insertion.ts";
export type {
  FieldForm,
  FieldInsertionContext,
  FieldInsertionMode,
  FieldInsertOptions,
} from "./field-insertion.ts";
export {
  explorerSectionIds,
  explorerSections,
  fieldLabel,
  sentenceCase,
  visibleSectionIds,
} from "./explorer-sections.ts";
export type {
  ExplorerReader,
  ExplorerSection,
  ExplorerSectionId,
} from "./explorer-sections.ts";
export { DataExplorer } from "./data-explorer.tsx";
export type {
  DataExplorerProps,
  ExplorerPresentation,
} from "./data-explorer.tsx";

export { WorkbenchDiagnosticsProvider } from "./source-diagnostics.tsx";
