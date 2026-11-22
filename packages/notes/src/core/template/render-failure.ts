import type { TemplateLanguage } from "@zotlit/templates/constants";
import {
  CitationInputError,
  MissingTemplateError,
  TemplateError,
} from "@zotlit/templates/facade";
import { ParseError, TokenizationError } from "@zotlit/templates/liquid";

import type {
  RenderCaller,
  RenderDiagnostic,
  RenderEngineLocation,
  SliceSite,
} from "./render-diagnostic.ts";
import { errorChain } from "./render-report.ts";

export interface RenderCallerSource {
  readonly source: string;
  readonly language: TemplateLanguage;
  readonly profileId?: string;
}

export type TemplateCallSites = (
  caller: RenderCallerSource,
  template: string | undefined,
) => readonly { from: number; to: number }[];

const noCallSites: TemplateCallSites = () => [];

export function renderFailureDiagnostic(
  error: unknown,
  caller: RenderCallerSource,
  callSites: TemplateCallSites = noCallSites,
): Omit<RenderDiagnostic, "part"> {
  const chain = errorChain(error);
  const syntax = chain.find(
    (link) => link instanceof ParseError || link instanceof TokenizationError,
  );
  const engine = engineLocation(syntax ? [syntax] : chain);
  const named = chain.find(
    (link): link is MissingTemplateError =>
      link instanceof MissingTemplateError,
  );
  const site = named
    ? callSites(caller, named.templateName)[0]
    : verifiedCallSite(callSites, caller, engine?.template);
  const from = callerOf(chain);
  const located =
    syntax ??
    chain.find((link) => liquidToken(link)?.file === engine?.template);
  const sourceSite =
    named || located === undefined
      ? undefined
      : errorSourceSite(located, caller);
  const attribution = {
    ...(engine ? { engine } : {}),
    ...(from ? { caller: from } : {}),
    ...(site ? { callSite: site } : {}),
    ...(sourceSite === undefined ? {} : { sourceSite }),
  };
  if (named)
    return {
      code: "missing-partial",
      params: { name: named.templateName },
      ...attribution,
    };
  if (syntax) {
    return {
      code: "liquid-syntax-error",
      ...(syntax instanceof ParseError &&
      "name" in syntax.token &&
      syntax.token.name === "for"
        ? { params: { tag: "for" } }
        : {}),
      message: errorText(error),
      ...attribution,
    };
  }
  return {
    code:
      engine?.template === "citation" &&
      site !== undefined &&
      chain.some((link) => link instanceof CitationInputError)
        ? "citation-data-mismatch"
        : "render-error",
    message: errorText(error),
    ...attribution,
  };
}

export function renderFailureSpan(error: unknown): SliceSite | undefined {
  for (const link of errorChain(error)) {
    const token = (link as { token?: unknown }).token;
    if (token === null || typeof token !== "object") continue;
    const { input, begin, end } = token as Record<string, unknown>;
    if (
      typeof input === "string" &&
      typeof begin === "number" &&
      typeof end === "number" &&
      begin < end
    ) {
      return { kind: "span", from: begin, to: end, source: input };
    }
  }
  return undefined;
}

function errorSourceSite(
  error: Error,
  caller: RenderCallerSource,
): RenderDiagnostic["sourceSite"] {
  const token = liquidToken(error);
  if (!token || caller.language !== "liquid" || caller.profileId === undefined)
    return undefined;
  const names = ["body", "managed", "annotation", "filename"].map(
    (part) => `${caller.profileId}:${part}`,
  );
  if (token.file !== "annotation" && !names.includes(token.file))
    return undefined;
  const offset = caller.source.indexOf(token.input);
  if (offset < 0 || caller.source.indexOf(token.input, offset + 1) !== -1)
    return undefined;
  return {
    from: offset + token.begin,
    to: offset + token.end,
    source: token.input,
    offset,
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function renderFailureCause(
  error: unknown,
): RenderFailureCause | undefined {
  const chain = errorChain(error);
  const missing = chain.find(
    (link): link is MissingTemplateError =>
      link instanceof MissingTemplateError,
  );
  if (missing) return { missing: missing.templateName };
  const at = engineLocation(chain);
  return at ? { at } : undefined;
}

export interface RenderFailureCause {
  readonly missing?: string;
  readonly at?: RenderEngineLocation;
}

function engineLocation(
  chain: readonly Error[],
): RenderEngineLocation | undefined {
  for (const link of chain) {
    if (link instanceof MissingTemplateError) return undefined;
    const token = liquidToken(link);
    if (token) {
      const before = token.input.slice(0, token.begin);
      const line = before.split("\n").length;
      return {
        template: token.file,
        line,
        column: token.begin - (before.lastIndexOf("\n") + 1) + 1,
      };
    }
    if (link instanceof TemplateError) return { template: link.templateName };
  }
  return undefined;
}

function callerOf(chain: readonly Error[]): RenderCaller | undefined {
  for (const link of chain) {
    const path = (link as { documentPath?: unknown }).documentPath;
    if (typeof path === "string" && path.endsWith(".md"))
      return { document: path };
  }
  return undefined;
}

function liquidToken(
  error: Error,
): { file: string; input: string; begin: number; end: number } | undefined {
  const token = (error as { token?: unknown }).token;
  if (token === null || typeof token !== "object") return undefined;
  const { file, input, begin, end } = token as Record<string, unknown>;
  return typeof file === "string" &&
    typeof input === "string" &&
    typeof begin === "number" &&
    typeof end === "number"
    ? { file, input, begin, end }
    : undefined;
}

function verifiedCallSite(
  callSites: TemplateCallSites,
  caller: RenderCallerSource,
  template: string | undefined,
): { from: number; to: number } | undefined {
  const calls = callSites(caller, template);
  return calls.length === 1 ? calls[0] : undefined;
}
