export {
  type FilterType,
  type ItemQuerySchema,
  type JsonType,
  type SchemaCapabilities,
  type SchemaCustomField,
  type SchemaField,
  type SchemaFunction,
  type SchemaMethod,
  type SchemaParameter,
  type SchemaProperty,
} from "./describe-item-query.ts";
export { describeQueryCustomFields } from "./describe-query-custom-fields.ts";
export {
  parameterTexts,
  parameterTypeText,
  resultText,
  signatureText,
  type ParameterText,
  type SignatureShape,
} from "./signature-text.ts";
// The function registry of the Filter Expression language, for in-process
// editors. The Query Schema stays the agent contract.
export {
  GLOBAL_FUNCTIONS,
  IF_FUNCTION,
  METHOD_ENTRIES,
  PROPERTY_ENTRIES,
  parameterAt,
  type FunctionDefinition,
  type FunctionParameter,
  type ParameterType,
  type PropertyDefinition,
} from "./filter-functions.ts";
export type { FilterValueType } from "./filter-values.ts";
export { cellProperties } from "./cell-properties.ts";
export { fieldSearchTerms, matchesSearchTerm } from "./field-search-terms.ts";
export {
  AttachmentFileResolver,
  type QueryDataset,
  type ResolveAttachmentFile,
} from "./dataset.ts";
export { ITEMS } from "./query-items.ts";
export {
  planItemFilter,
  testItemSeed,
  type ItemFilter,
  type SeedTest,
} from "./item-filter.ts";
export {
  queryItemFrom,
  queryItemSeedSchema,
  readQueryItemSeed,
  type QueryItemSeed,
} from "./item-seed.ts";
export { ANNOTATIONS } from "./query-annotations.ts";
export {
  ItemQueryError,
  type ItemQueryErrorCode,
  type ItemQueryErrorLocation,
} from "./error.ts";
// The typed database failures of `collectQuery`, `consumeQuery`, and
// `describeQueryCustomFields`, from the readers of `@zotlit/db/item-query`.
export {
  ItemQueryDatabaseError,
  ItemQueryLayoutError,
} from "@zotlit/db/item-query";
export { QueryTimeZone } from "./query-clock.ts";
export {
  collectQuery,
  consumeQuery,
  type QueryConsumer,
  type QuerySummary,
} from "./query.ts";
export { COUNT_FIELDS, UNLIMITED_LIMIT } from "./request.ts";
export { planPath } from "./projection.ts";
export {
  subexpressionTypes,
  type ContextRecord,
  type PlannedMember,
  type SubexpressionType,
} from "./subexpression-types.ts";
export type { StaticType } from "./filter-plan.ts";
export {
  projectedSortKey,
  type LastActivitySource,
  type SortKey,
} from "./fields.ts";
export { compareScalars, compareStrings } from "./collation.ts";
export { errorValueText } from "./filter-values.ts";
export {
  errorCell,
  valueText,
  type ErrorCell,
  type ProjectionJson,
} from "./value-text.ts";
export { nameDictionary, type NameDictionary } from "./name-dictionary.ts";
export {
  FORMULA_NAME,
  FORMULA_SEGMENT,
  formulaReferences,
  type FormulaFaultPolicy,
  type FormulaReference,
} from "./formulas.ts";
export type {
  FormulaDiagnostics,
  ItemQuery,
  ItemQueryRequest,
  ProjectionValue,
  QueryResult,
  QueryGroup,
  GroupValue,
  QueryContext,
  QueryRow,
  SortSpec,
  TargetLibrary,
} from "./request.ts";
export {
  ItemQueryScheduler,
  ItemQuerySliceObserver,
  SLICE_BUDGET_MS,
  type SliceObserver,
} from "./scheduler.ts";

export {
  diagnoseDecode,
  renderDiagnostic,
  type Diagnostic,
  type DiagnosticLocation,
} from "./diagnose.ts";
export { nearMatches } from "./near-match.ts";
export type {
  Fault,
  ItemQueryFault,
  PlainFault,
  Span,
  Role,
  Receiver,
  Callee,
  SyntaxFault,
} from "./fault.ts";

export { ATTACHMENTS } from "./query-attachments.ts";

export { listQueryValues, type QueryValuesRequest } from "./query-values.ts";
