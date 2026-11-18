// Editor-independent Template Completion API for web and native Obsidian adapters.
export {
  suggestions,
  completionEdit,
  hoverHint,
  rootAt,
} from "./suggestions.ts";
export type { LiquidTagName } from "./tag-help.ts";
export type {
  Suggestion,
  SuggestionConfig,
  SuggestionResult,
  CompletionEdit,
} from "./suggestions.ts";
