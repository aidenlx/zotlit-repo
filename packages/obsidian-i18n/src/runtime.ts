import { parseNumericLiteral } from "./language-pack.ts";
import type { Expression, LanguagePack, Message } from "./language-pack.ts";
import { noopLogger } from "./logger.ts";
import type { StructuredLogger } from "./logger.ts";

type Variables = Record<string, unknown>;

type RenderMessageOptions = {
  locale: string;
  inputs: Record<string, unknown>;
};

export type TargetLocaleMessages = Readonly<
  Record<string, Readonly<Record<string, Message>>>
>;

export type LanguagePackRuntime = {
  install(pack: LanguagePack): void;
  reset(): void;
  getLocale(): string;
  setLogger(logger: StructuredLogger): void;
  setTargetLocale(locale: string): void;
  translate(messageId: string, inputs?: Record<string, unknown>): string;
  translateTarget(messageId: string, inputs?: Record<string, unknown>): string;
};

export type CreateLanguagePackRuntimeOptions = {
  targetLocaleMessages?: TargetLocaleMessages;
};

export type DatetimeInput =
  | string
  | number
  | Temporal.Instant
  | Temporal.PlainDate;

export function createLanguagePackRuntime(
  basePack: LanguagePack,
  { targetLocaleMessages = {} }: CreateLanguagePackRuntimeOptions = {},
): LanguagePackRuntime {
  let logger: StructuredLogger = noopLogger;
  let activePack = basePack;
  let target:
    | { locale: string; messages: Readonly<Record<string, Message>> }
    | undefined;
  const reportedFallbacks = new Set<string>();

  const reportFallback = (
    messageId: string,
    reason: string,
    error?: unknown,
  ): void => {
    if (reportedFallbacks.has(messageId)) return;
    reportedFallbacks.add(messageId);
    logger.debug("Falling back to the base locale for {messageId}: {reason}", {
      messageId,
      reason,
      error,
    });
  };

  const renderFrom = (
    {
      messages,
      locale,
      source,
    }: {
      messages: Readonly<Record<string, Message>>;
      locale: string;
      source?: string;
    },
    messageId: string,
    inputs: Record<string, unknown>,
  ): string | undefined => {
    const message = messages[messageId];
    if (message === undefined) {
      if (source !== undefined) {
        reportFallback(messageId, `the ${source} does not translate it`);
      }
      return undefined;
    }
    try {
      const rendered = renderMessage(message, { locale, inputs });
      if (rendered !== undefined) return rendered;
      if (source !== undefined) {
        reportFallback(messageId, `no variant matched in the ${source}`);
      }
    } catch (error) {
      if (source !== undefined) {
        reportFallback(
          messageId,
          `the ${source} message failed to render`,
          error,
        );
      }
    }
    return undefined;
  };

  const renderFromBase = (
    messageId: string,
    inputs: Record<string, unknown>,
  ): string => {
    const baseMessage = basePack.messages[messageId];
    if (baseMessage === undefined) {
      logger.warn("No base-pack message for {messageId}", { messageId });
      return messageId;
    }
    try {
      const rendered = renderMessage(baseMessage, {
        locale: basePack.locale,
        inputs,
      });
      if (rendered !== undefined) return rendered;
      logger.warn("Base-pack message {messageId} matched no variant", {
        messageId,
        inputs,
      });
    } catch (error) {
      logger.warn("Base-pack message {messageId} failed to render", {
        messageId,
        inputs,
        error,
      });
    }
    return messageId;
  };

  const translate = (
    messageId: string,
    inputs: Record<string, unknown> = {},
  ): string =>
    renderFrom(
      {
        messages: activePack.messages,
        locale: activePack.locale,
        source: activePack === basePack ? undefined : "active pack",
      },
      messageId,
      inputs,
    ) ?? renderFromBase(messageId, inputs);

  const translateTarget = (
    messageId: string,
    inputs: Record<string, unknown> = {},
  ): string =>
    (target === undefined
      ? undefined
      : renderFrom(
          { ...target, source: "target-locale subset" },
          messageId,
          inputs,
        )) ?? renderFromBase(messageId, inputs);

  return {
    install(pack) {
      activePack = pack;
      reportedFallbacks.clear();
      logger.info(
        "Active Language Pack is {locale} with {messageCount} messages",
        {
          locale: pack.locale,
          messageCount: Object.keys(pack.messages).length,
        },
      );
    },
    getLocale() {
      return activePack.locale;
    },
    reset() {
      activePack = basePack;
      target = undefined;
      reportedFallbacks.clear();
    },
    setLogger(nextLogger) {
      logger = nextLogger;
    },
    setTargetLocale(locale) {
      const messages = targetLocaleMessages[locale];
      target = messages === undefined ? undefined : { locale, messages };
      reportedFallbacks.clear();
    },
    translate,
    translateTarget,
  };
}

function renderMessage(
  message: Message,
  { locale, inputs }: RenderMessageOptions,
): string | undefined {
  if (typeof message === "string") return message;

  const variables: Variables = {};
  const inputNames = new Set(
    message.declarations
      .filter((declaration) => declaration.type === "input")
      .map((declaration) => declaration.name),
  );
  for (const name of inputNames) {
    variables[name] = inputs[name];
  }
  for (const declaration of message.declarations) {
    if (declaration.type === "local") {
      variables[declaration.name] = resolveExpression(
        declaration.value,
        locale,
        variables,
      );
    }
  }

  const variant = message.variants.find((candidate) =>
    candidate.matches.every(
      (match) =>
        match.type === "catchall" ||
        matchesLiteral(
          variables[match.key],
          match.value,
          inputNames.has(match.key),
        ),
    ),
  );
  return variant?.pattern
    .map((expression) =>
      String(resolveExpression(expression, locale, variables)),
    )
    .join("");
}

function matchesLiteral(
  value: unknown,
  literal: string,
  isInput: boolean,
): boolean {
  if (value === literal) return true;
  if (!isInput) return false;
  const numericLiteral = parseNumericLiteral(literal);
  return numericLiteral !== undefined && value === numericLiteral;
}

function resolveExpression(
  expression: Expression,
  locale: string,
  variables: Variables,
): unknown {
  switch (expression.type) {
    case "text":
    case "literal":
      return expression.value;
    case "variable":
      return variables[expression.name];
    case "formatter": {
      const argument = resolveExpression(
        expression.argument,
        locale,
        variables,
      );
      const options = Object.fromEntries(
        Object.entries(expression.options).map(([name, value]) => [
          name,
          resolveExpression(value, locale, variables),
        ]),
      );
      const formatterName = expression.name;
      switch (formatterName) {
        case "plural":
          return new Intl.PluralRules(locale, options).select(Number(argument));
        case "number":
          return new Intl.NumberFormat(locale, options).format(
            Number(argument),
          );
        case "datetime":
          return new Intl.DateTimeFormat(locale, options).format(
            toEpochMilliseconds(argument),
          );
        default:
          formatterName satisfies never;
          return undefined;
      }
    }
  }
}

function toEpochMilliseconds(argument: unknown): number {
  if (typeof argument === "number") return argument;
  const text = String(argument);
  try {
    return Temporal.Instant.from(text).epochMilliseconds;
  } catch {
    return Temporal.PlainDate.from(text).toZonedDateTime("UTC")
      .epochMilliseconds;
  }
}
