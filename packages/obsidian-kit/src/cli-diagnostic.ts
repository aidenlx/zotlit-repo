import { diagnoseDecode, renderDiagnostic } from "@zotlit/item-query";
import type { Diagnostic as RenderedDiagnostic } from "@zotlit/item-query";

import type { CliRejection } from "./cli-params.ts";

export type { RenderedDiagnostic };

export const INVALID_ARGUMENT_HINT =
  "Correct the parameter named in details.parameter, then run the command again.";

export const SOURCE_UNAVAILABLE_HINT =
  "Run the command again once the connected Zotero source is readable; when the message reports a failure, ask the user to check the plugin log.";

type DiagnosticCode<THints> = Extract<keyof THints, string>;

export function createCliDiagnostics<
  const THints extends Readonly<Record<string, string>>,
  TDetails,
>(hints: THints, invalidParameterCode: DiagnosticCode<THints>) {
  type Code = DiagnosticCode<THints>;

  function buildDiagnostic<TDiagnosticDetails>(
    code: Code,
    message: string,
    details?: TDiagnosticDetails,
  ) {
    const hint: string = hints[code]!;
    return { code, message, hint, details };
  }

  function diagnostic(code: Code, message: string, details?: TDetails) {
    return buildDiagnostic(code, message, details);
  }

  function rejectionDiagnostic(rejection: CliRejection) {
    const rejected = buildDiagnostic(invalidParameterCode, rejection.message, {
      parameter: rejection.parameter,
    });
    return rejection.hint === undefined
      ? rejected
      : { ...rejected, hint: rejection.hint };
  }

  return { diagnostic, rejectionDiagnostic };
}

export interface SourceFault {
  readonly source: string;
  readonly span: { readonly from: number; readonly to: number };
  readonly name: string;
}

export interface FaultFacts {
  readonly hint?: string;
  readonly at?: SourceFault;
  readonly path?: string;
}

export function lineColumn(
  source: string,
  offset: number,
): { readonly line: number; readonly column: number } {
  const before = source.slice(0, offset);
  const lineStart = before.lastIndexOf("\n") + 1;
  return { line: before.split("\n").length, column: offset - lineStart + 1 };
}

export function createRenderedCliDiagnostics<
  const THints extends Readonly<Record<string, string>>,
  TDetails,
>(hints: THints, invalidParameterCode: DiagnosticCode<THints>) {
  type Code = DiagnosticCode<THints>;
  const base = createCliDiagnostics<THints, TDetails>(
    hints,
    invalidParameterCode,
  );

  function diagnostic(code: Code, message: string, details?: TDetails) {
    return faultDiagnostic(code, message, { details });
  }

  function faultDiagnostic(
    code: Code,
    message: string,
    facts: FaultFacts & { readonly details?: TDetails },
  ) {
    const value = base.diagnostic(code, message, facts.details);
    const registered = value.hint;
    const hint = facts.hint ?? registered;
    const withRegistered = (report: readonly string[]): readonly string[] =>
      hint === registered ? report : [...report, registered];
    const { at } = facts;
    if (!at) {
      const rendered = renderDiagnostic({
        code,
        message,
        hint,
        ...(facts.path ? { location: { path: facts.path } } : {}),
      });
      return { ...value, ...rendered, report: withRegistered(rendered.report) };
    }
    const { line, column } = lineColumn(at.source, at.span.from);
    const lineStart = at.span.from - column + 1;
    const lineEnd = at.source.indexOf("\n", lineStart);
    const text = at.source.slice(
      lineStart,
      lineEnd === -1 ? undefined : lineEnd,
    );
    const rendered = renderDiagnostic(
      {
        code,
        message,
        hint,
        location: {
          span: {
            from: at.span.from - lineStart,
            to: Math.min(at.span.to, lineStart + text.length) - lineStart,
          },
        },
      },
      text,
      { found: at.source.slice(at.span.from, at.span.to) },
    );
    const [head, ...rest] = rendered.report;
    return {
      ...value,
      ...rendered,
      location: { span: at.span, ...(facts.path ? { path: facts.path } : {}) },
      report: withRegistered([
        head!,
        `--> ${at.name}:${line}:${column}`,
        ...rest,
      ]),
    };
  }

  function rejectionDiagnostic(rejection: CliRejection) {
    const value = base.rejectionDiagnostic(rejection);
    return {
      ...value,
      ...diagnoseDecode(rejection, value.hint),
      code: value.code,
    };
  }

  return { diagnostic, faultDiagnostic, rejectionDiagnostic };
}
