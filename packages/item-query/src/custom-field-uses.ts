import type { ItemQueryFault, Span } from "./fault.ts";
import type { FilterPlan } from "./filter-plan.ts";
import type { FormulaSourceFault } from "./formulas.ts";

export interface ExpressionUse {
  readonly name: string;
  readonly bare: boolean;
  readonly deferred?: Extract<ItemQueryFault, { kind: "unknown" }>;
  readonly dotted?: boolean;
  readonly at: Span;
}

export function expressionUse(
  {
    name,
    bare,
    from,
    to,
    deferred,
    dotted,
  }: FilterPlan["customFields"][number],
  known: ReadonlySet<string>,
): ExpressionUse {
  return dotted && !known.has(name) && known.has(dotted.name)
    ? {
        name: dotted.name,
        bare,
        dotted: true,
        at: { from: dotted.from, to: dotted.to },
      }
    : { name, bare, deferred, at: { from, to } };
}

export function isMissing(
  { name, deferred, dotted }: Omit<ExpressionUse, "at">,
  known: ReadonlySet<string>,
): boolean {
  return Boolean(dotted || deferred || !known.has(name));
}

export function missingFault(
  names: readonly string[],
  { name, bare, deferred, dotted }: Omit<ExpressionUse, "at">,
  at: Span,
): ItemQueryFault {
  return deferred && !names.includes(name)
    ? deferred
    : {
        kind: "unknown",
        role: bare && !deferred && !dotted ? "field" : "custom-field",
        name,
        at,
        customFields: names,
        ...(deferred || dotted ? { dotted: true } : {}),
      };
}

export function missingCustomField(
  plan: Pick<FilterPlan, "customFields">,
  names: readonly string[],
): FormulaSourceFault | null {
  const known = new Set(names);
  for (const use of plan.customFields) {
    const read = expressionUse(use, known);
    if (isMissing(read, known))
      return { fault: missingFault(names, read, read.at), at: read.at };
  }
  return null;
}
