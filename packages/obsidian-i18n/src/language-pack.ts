export type LanguagePack = {
  schemaVersion: 1;
  locale: string;
  messages: Record<string, Message>;
};

export type Message =
  | string
  | {
      declarations: Declaration[];
      variants: Variant[];
    };

export type Declaration =
  | { type: "input"; name: string }
  | { type: "local"; name: string; value: Expression };

export type Expression =
  | { type: "text"; value: string }
  | { type: "variable"; name: string }
  | { type: "literal"; value: string }
  | {
      type: "formatter";
      name: LanguagePackFormatter;
      argument: Expression;
      options: Record<string, Expression>;
    };

export type Variant = {
  matches: Match[];
  pattern: Expression[];
};

export type Match =
  | { type: "literal"; key: string; value: string }
  | { type: "catchall"; key: string };

export const LANGUAGE_PACK_FORMATTERS = [
  "plural",
  "number",
  "datetime",
] as const;

export type LanguagePackFormatter = (typeof LANGUAGE_PACK_FORMATTERS)[number];

const formatterNames = new Set<string>(LANGUAGE_PACK_FORMATTERS);

export function isSupportedLanguagePackFormatter(
  name: string,
): name is LanguagePackFormatter {
  return formatterNames.has(name);
}

const EXCLUDED_NUMERIC_SPELLING = /^(?:0[bBoOxX]|[+-]?Infinity$|NaN$)/;

export function parseNumericLiteral(text: string): number | undefined {
  if (text.length === 0 || text.trim() !== text) return undefined;
  if (EXCLUDED_NUMERIC_SPELLING.test(text)) return undefined;
  const value = Number(text);
  if (!Number.isFinite(value)) return undefined;
  if (Number.isInteger(value) && !Number.isSafeInteger(value)) return undefined;
  return value;
}

export function isLanguagePackFileName(name: string): boolean {
  return /^[\w-]+\.json$/.test(name);
}
