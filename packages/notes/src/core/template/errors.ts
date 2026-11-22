import { regex } from "arkregex";
import { Predicate, Schema } from "effect";

import { MissingTemplateError } from "@zotlit/templates/facade";

import type { PartialNameRefusal } from "./defaults.ts";
import { renderFailureCause, renderFailureSpan } from "./render-failure.ts";

export class InertTemplateError extends Error {
  readonly _tag = "InertTemplateError";
  readonly templateName: string | undefined;

  constructor(message: string, templateName?: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "InertTemplateError";
    this.templateName = templateName;
  }
}

export const isInertTemplateError = (
  error: unknown,
): error is InertTemplateError =>
  Predicate.isTagged(error, "InertTemplateError");

export class PartialNameError extends Error {
  readonly _tag = "PartialNameError";
  readonly partialName: string;
  readonly refusal: PartialNameRefusal;

  constructor(partialName: string, refusal: PartialNameRefusal) {
    super(`Refused the Shared Partial name '${partialName}': ${refusal}`);
    this.name = "PartialNameError";
    this.partialName = partialName;
    this.refusal = refusal;
  }
}

export class MissingPartialError extends MissingTemplateError {
  readonly documentPath: string;

  constructor(documentPath: string, templateName: string, cause: unknown) {
    super(templateName, { cause });
    this.documentPath = documentPath;
  }
}

export interface EngineFaultSpan {
  readonly source: string;
  readonly template?: string;
  readonly from: number;
  readonly to: number;
}

const ENGINE_POSITION = regex(
  "(?:at line (?<etaLine>\\d+) col (?<etaColumn>\\d+)|line:(?<liquidLine>\\d+), col:(?<liquidColumn>\\d+))",
);

export function engineFaultSpan(
  error: unknown,
  source?: string,
): EngineFaultSpan | undefined {
  const site = renderFailureSpan(error);
  if (site?.kind === "span") {
    const template = renderFailureCause(error)?.at?.template;
    return {
      source: site.source,
      ...(template === undefined ? {} : { template }),
      from: site.from,
      to: site.to,
    };
  }
  if (source === undefined || !(error instanceof Error)) return undefined;
  return reportedFaultSpan(error.message, source);
}

export function reportedFaultSpan(
  message: string,
  source: string,
): EngineFaultSpan | undefined {
  const groups = ENGINE_POSITION.exec(message)?.groups;
  if (!groups) return undefined;
  const line = Number(groups.etaLine ?? groups.liquidLine);
  const column = Number(groups.etaColumn ?? groups.liquidColumn);
  const lines = source.split("\n");
  if (line < 1 || line > lines.length) return undefined;
  const lineStart = lines
    .slice(0, line - 1)
    .reduce((offset, text) => offset + text.length + 1, 0);
  const from = lineStart + Math.min(column - 1, lines[line - 1]!.length);
  return { source, from, to: Math.min(from + 1, source.length) };
}

export class TemplateOperationError extends Schema.TaggedError<
  TemplateOperationError,
  { readonly brand: unique symbol }
>()("TemplateOperationError", {
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

export class TemplateRenderError extends Schema.TaggedError<
  TemplateRenderError,
  { readonly brand: unique symbol }
>()("TemplateRenderError", {
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

export function plainTemplateError(error: unknown): unknown {
  return error instanceof TemplateOperationError ||
    error instanceof TemplateRenderError
    ? error.cause
    : error;
}
