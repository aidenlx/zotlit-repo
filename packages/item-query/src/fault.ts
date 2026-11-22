import type {
  BinaryOperator,
  ExpressionSyntaxError,
} from "@zotlit/filter-expression";

import type { ItemQueryErrorCode } from "./error.ts";
import type { ValueShape } from "./fields.ts";
import type { StaticType } from "./filter-plan.ts";
import type { FormulaError } from "./formulas.ts";

export interface Span {
  readonly from: number;
  readonly to: number;
}
export type SyntaxFault = ExpressionSyntaxError;
export type Role =
  | "field"
  | "custom-field"
  | "global"
  | "method"
  | "property"
  | "projection-path"
  | "sortable-field"
  | "formula";
export interface Receiver {
  readonly type: StaticType;
  readonly at: Span;
  readonly field?: string;
}
export interface Callee {
  readonly name: string;
  readonly receiver?: Receiver;
}
export type Fault =
  | {
      readonly kind: "group";
      readonly problem: "scalar" | "list" | "each";
      readonly name: string;
      readonly at: Span;
    }
  | { readonly kind: "syntax"; readonly fault: SyntaxFault }
  | { readonly kind: "custom-key"; readonly at: Span }
  | {
      readonly kind: "unknown";
      readonly role: Role;
      readonly name: string;
      readonly at: Span;
      readonly receiver?: Receiver;
      readonly customFields?: readonly string[];
      readonly dotted?: boolean;
      readonly formulas?: readonly string[];
      readonly pathResolution?: {
        readonly found: ValueShape["kind"];
        readonly expected: "list" | "list-element";
        readonly offset: number;
      };
    }
  | {
      readonly kind: "arity";
      readonly callee: Callee;
      readonly at: Span;
      readonly given: number;
    }
  | {
      readonly kind: "argument-type";
      readonly callee: Callee;
      readonly at: Span;
      readonly index: number;
      readonly found: string;
      readonly expected: string;
    }
  | { readonly kind: "unreadable"; readonly name: string; readonly at: Span }
  | {
      readonly kind: "operand-type";
      readonly operator: string;
      readonly operands: readonly Receiver[];
      readonly at: Span;
    }
  | {
      readonly kind: "formula-cycle";
      readonly chain: readonly string[];
      readonly at: Span;
    }
  | FaultedFormulaRead
  | { readonly kind: "formula-name"; readonly name: string }
  | {
      readonly kind: "formula-result";
      readonly name: string;
      readonly found: StaticType;
      readonly at: Span;
    }
  | {
      readonly kind: "plain";
      readonly code: ItemQueryErrorCode;
      readonly at?: Span;
      readonly message: string;
      readonly action: string;
    }
  | {
      readonly kind: "constant";
      readonly value: boolean;
      readonly operator: BinaryOperator;
      readonly left: Receiver;
      readonly right: Receiver;
      readonly at: Span;
    };
export interface FaultedFormulaRead {
  readonly kind: "reads-faulted-formula";
  readonly name: string;
  readonly at: Span;
  readonly root: FormulaError;
}
export type PlainFault = Extract<Fault, { kind: "plain" }>;
export type ItemQueryFault = Exclude<Fault, { kind: "constant" }>;
