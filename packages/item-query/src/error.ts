import { Data } from "effect";

import type { QueryDataset } from "./dataset.ts";
import type { Diagnostic } from "./diagnose.ts";
import { diagnose } from "./diagnose.ts";
import type { ItemQueryFault, Span } from "./fault.ts";
import type { FormulaDiagnostics, QueryContext } from "./request.ts";

export type ItemQueryErrorCode =
  | "duplicate-library"
  | "invalid-group"
  | "invalid-path"
  | "unknown-field"
  | "unknown-path"
  | "unsortable-field"
  | "invalid-limit"
  | "invalid-filter"
  | "unfilterable-field"
  | "unknown-function"
  | "unknown-property"
  | "wrong-argument-count"
  | "wrong-argument-type"
  | "wrong-operand-type"
  | "invalid-context"
  | "unbound-context"
  | "invalid-formula-name"
  | "invalid-formula-result"
  | "unknown-formula"
  | "formula-cycle"
  | "reads-faulted-formula";

export interface ItemQueryErrorLocation {
  readonly argument:
    | "libraries"
    | "filter"
    | "fields"
    | "sort"
    | "limit"
    | "group"
    | "context"
    | "formulas";
  readonly index?: number;
  readonly path?: string;
  readonly span?: Span;
}

export class ItemQueryError extends Data.TaggedError("ItemQueryError")<{
  readonly fault: ItemQueryFault;
  readonly dataset: QueryDataset;
  readonly argumentText?: string;
  readonly location: ItemQueryErrorLocation;
  readonly context?: QueryContext | undefined;
  readonly formulaDiagnostics?: FormulaDiagnostics | undefined;
}> {
  #diagnostic: Diagnostic<ItemQueryErrorCode> | undefined;

  get code(): ItemQueryErrorCode {
    return this.diagnostic.code;
  }
  override get message(): string {
    return this.diagnostic.message;
  }
  get hint(): string {
    return this.diagnostic.hint;
  }

  get diagnostic(): Diagnostic<ItemQueryErrorCode> {
    this.#diagnostic ??= diagnose(this.fault, this.argumentText ?? "", {
      ...this.location,
      dataset: this.dataset,
      context: this.context,
    });
    return this.#diagnostic;
  }
}
