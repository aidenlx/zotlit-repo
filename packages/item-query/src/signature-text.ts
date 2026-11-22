import type { FunctionParameter } from "./filter-functions.ts";
import type { FilterValueType } from "./filter-values.ts";

type Parameter = Pick<
  FunctionParameter,
  "name" | "type" | "nullable" | "values"
>;

export interface SignatureShape {
  readonly parameters: readonly Parameter[];
  readonly optional?: readonly Parameter[] | undefined;
  readonly rest?: Parameter | null | undefined;
}

export interface ParameterText<P extends Parameter = Parameter> {
  readonly parameter: P;
  readonly optional: boolean;
  readonly rest: boolean;
  readonly text: string;
}

export function parameterTypeText(parameter: Parameter): string {
  const types = parameter.values
    ? parameter.values.map((value) => JSON.stringify(value))
    : typeof parameter.type === "string"
      ? [parameter.type]
      : parameter.type;
  return [...types, ...(parameter.nullable ? ["null"] : [])].join(" | ");
}

export function parameterTexts<P extends Parameter>(definition: {
  readonly parameters: readonly P[];
  readonly optional?: readonly P[] | undefined;
  readonly rest?: P | null | undefined;
}): ParameterText<P>[] {
  const entry = (parameter: P, optional: boolean, rest: boolean) => ({
    parameter,
    optional,
    rest,
    text: `${rest ? "..." : ""}${parameter.name}${optional && !rest ? "?" : ""}: ${parameterTypeText(parameter)}`,
  });
  return [
    ...definition.parameters.map((p) => entry(p, false, false)),
    ...(definition.optional ?? []).map((p) => entry(p, true, false)),
    ...(definition.rest ? [entry(definition.rest, true, true)] : []),
  ];
}

export const resultText = (
  returns: FilterValueType | null | undefined,
): string => returns ?? "any";

export function signatureText(
  name: string,
  definition: SignatureShape & {
    readonly returns?: FilterValueType | null | undefined;
  },
): string {
  const parameters = parameterTexts(definition).map(({ text }) => text);
  return `${name}(${parameters.join(", ")}) → ${resultText(definition.returns)}`;
}
