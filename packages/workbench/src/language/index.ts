export { eta, etaLanguage, etaRange, etaBody } from "./eta-language.ts";
export type { EtaRange } from "./eta-language.ts";
export { etaAutoPair } from "./eta-auto-pair.ts";
export {
  liquidTemplate,
  liquidBody,
  liquidRanges,
  STRUCTURAL_TAGS,
} from "./liquid.ts";
export type { LiquidRange } from "./liquid.ts";
export { jsonRule, embeddedJsonE } from "./json-e-language.ts";
export {
  applyTemplateCompletion,
  completionSuggestion,
  templateCompletion,
} from "./completion.ts";
export type { SuggestionSource, CompletionPresentation } from "./completion.ts";
export {
  expressionCompletions,
  expressionOption,
  filterExpressionCompletion,
} from "./filter-expression-completion.ts";
export type {
  ExpressionCompletionResult,
  ExpressionField,
  ExpressionName,
  ExpressionOption,
  ExpressionReceiver,
  ExpressionVocabulary,
} from "./filter-expression-completion.ts";
export { VAULT_SEGMENT } from "./expression-options.ts";
export { datasetVocabulary } from "./expression-vocabulary.ts";
export {
  completionEdit,
  hoverHint,
  rootAt,
  suggestions,
} from "./suggestions.ts";
export type {
  ResolveStart,
  Suggestion,
  SuggestionCategory,
  SuggestionConfig,
  SuggestionResult,
  CompletionEdit,
} from "./suggestions.ts";

export {
  templateHighlighter,
  templateHighlighting,
  templateToken,
} from "./highlight.ts";
export type { TemplateToken } from "./highlight.ts";
export { embeddedTemplates } from "./embedded.ts";
export { signatureAt } from "./signature-hint.ts";
export {
  SIGNATURE_HINT_CLASS,
  signatureHint,
} from "./signature-hint-tooltip.ts";
export {
  fieldPopup,
  fieldPopupKeyHost,
  syntaxCompletion,
} from "./field-popup.ts";
export type {
  FieldPopup,
  FieldPopupKeyHost,
  FieldPopupKeys,
  FieldPopupRelease,
} from "./field-popup.ts";
export type {
  HintParameter,
  HintSignature,
  SignatureHintOptions,
  SignatureHintResult,
} from "./signature-hint.ts";

export { templatePairing } from "./pairing.ts";
export type { PairingSource } from "./pairing.ts";
export type { PlacedFault, Span } from "./span.ts";
export { appendProse } from "./prose.ts";
