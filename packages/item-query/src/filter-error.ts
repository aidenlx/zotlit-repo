import type { FilterValue, FilterValueType } from "./filter-values.ts";

export type EvaluationFault =
  | {
      readonly code: "wrong-operand-type";
      readonly operator: string;
      readonly found: readonly FilterValueType[];
    }
  | {
      readonly code: "wrong-argument-type";
      readonly callee: string;
      readonly index: number;
      readonly found: FilterValueType;
      readonly expected: readonly string[];
    }
  | {
      readonly code: "wrong-subject-type";
      readonly callee: string;
      readonly found: FilterValueType;
    }
  | {
      readonly code: "not-finite";
      readonly operation: string;
    }
  | {
      readonly code: "unparseable-text";
      readonly callee: "number" | "date" | "duration";
      readonly text: string;
    }
  | {
      readonly code: "argument-out-of-range";
      readonly callee: string;
      readonly index: number;
      readonly found: string;
    }
  | {
      readonly code: "invalid-index";
      readonly found: string;
    }
  | {
      readonly code: "date-out-of-range";
      readonly operator: string;
    };

export type EvaluationErrorCode = EvaluationFault["code"];

export const EVALUATION_ERROR_CODES = [
  "wrong-operand-type",
  "wrong-argument-type",
  "wrong-subject-type",
  "not-finite",
  "unparseable-text",
  "argument-out-of-range",
  "invalid-index",
  "date-out-of-range",
] as const satisfies readonly EvaluationErrorCode[];

type Exhaustive<Missing extends never> = Missing;
export type EvaluationErrorCodesExhaustive = Exhaustive<
  Exclude<EvaluationErrorCode, (typeof EVALUATION_ERROR_CODES)[number]>
>;

export interface ErrorValue {
  readonly type: "error";
  readonly fault: EvaluationFault;
}

export function errorValue(fault: EvaluationFault): ErrorValue {
  return { type: "error", fault };
}

export function isError(value: FilterValue | undefined): value is ErrorValue {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (value as { type: string }).type === "error"
  );
}

export function firstError(
  args: readonly FilterValue[],
): ErrorValue | undefined {
  return args.find((value) => isError(value));
}

export function typeNoun(type: string): string {
  return `${/^[aeiou]/.test(type) ? "an" : "a"} ${type}`;
}

export function operandMessage(
  operator: string,
  found: readonly string[],
): string {
  return `The operator ${operator} cannot use ${found.map(typeNoun).join(" and ")}.`;
}

export function renderEvaluationFault(fault: EvaluationFault): string {
  switch (fault.code) {
    case "wrong-operand-type":
      return operandMessage(fault.operator, fault.found);
    case "wrong-argument-type":
      return `Argument ${fault.index + 1} of ${fault.callee} is ${typeNoun(fault.found)}; ${fault.callee} takes ${fault.expected.join(" or ")} there.`;
    case "wrong-subject-type":
      return `${fault.callee} does not apply to ${typeNoun(fault.found)}.`;
    case "not-finite":
      return `The result of ${fault.operation} is not a finite number.`;
    case "unparseable-text":
      return `${fault.callee}() cannot read ${JSON.stringify(fault.text)} as ${typeNoun(fault.callee)}.`;
    case "argument-out-of-range":
      return `Argument ${fault.index + 1} of ${fault.callee} is ${fault.found}, outside the values that ${fault.callee} takes.`;
    case "invalid-index":
      return `The index ${fault.found} is not an integer.`;
    case "date-out-of-range":
      return `The date arithmetic of ${fault.operator} gives a date outside the range of dates.`;
  }
}
