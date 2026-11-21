export { eta, etaLanguage, etaBody } from "./eta-language.ts";
export { liquidTemplate, liquidBody } from "./liquid.ts";
export { jsonRule, embeddedJsonE } from "./json-e-language.ts";
export { completionSuggestion, templateCompletion } from "./completion.ts";
export type { SuggestionSource, CompletionPresentation } from "./completion.ts";
export { expressionOption } from "./filter-expression-completion.ts";
export type { ExpressionVocabulary } from "./filter-expression-completion.ts";
export { VAULT_SEGMENT } from "./expression-options.ts";
export { datasetVocabulary } from "./expression-vocabulary.ts";
export type {
  ResolveStart,
  Suggestion,
  SuggestionConfig,
} from "./suggestions.ts";

export { templateHighlighting } from "./highlight.ts";
export { embeddedTemplates } from "./embedded.ts";
export { fieldPopupKeyHost } from "./field-popup.ts";
export type { FieldPopupKeyHost, FieldPopupKeys } from "./field-popup.ts";

export { templatePairing } from "./pairing.ts";
export type { PlacedFault, Span } from "./span.ts";
export { appendProse } from "./prose.ts";
