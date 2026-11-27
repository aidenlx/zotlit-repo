import { isMemberName } from "@zotlit/filter-expression";

import type { QueryDataset } from "./dataset.ts";
import type { Span } from "./fault.ts";
import type { StaticType } from "./filter-plan.ts";
import { planFormulas } from "./formulas.ts";
import { NOTE_FIELDS } from "./note-fields.ts";
import { ANNOTATIONS } from "./query-annotations.ts";
import { ATTACHMENTS } from "./query-attachments.ts";
import { ITEMS } from "./query-items.ts";
import type { QueryContext } from "./request.ts";

export interface PlannedMember {
  readonly name: string;
  readonly valueType: StaticType;
}

export interface SubexpressionType {
  readonly valueType: StaticType;
  readonly members?: readonly PlannedMember[];
}

export type ContextRecord = keyof QueryContext;

let memberNames: readonly string[] | undefined;

function recordMemberNames(): readonly string[] {
  memberNames ??= [
    ...new Set(
      [
        ...[ITEMS, ATTACHMENTS, ANNOTATIONS].flatMap((dataset) =>
          dataset.names.map((name) => name.split(".")[0]!),
        ),
        ...NOTE_FIELDS.keys(),
      ].filter(isMemberName),
    ),
  ];
  return memberNames;
}

export function subexpressionTypes(
  dataset: QueryDataset,
  {
    context = [],
    formulas,
  }: {
    context?: readonly ContextRecord[];
    formulas?: Readonly<Record<string, string>>;
  } = {},
): (text: string, at: Span) => SubexpressionType | undefined {
  const bound: QueryContext | undefined =
    context.length === 0
      ? undefined
      : Object.fromEntries(context.map((record) => [record, ""]));
  const planner =
    formulas &&
    planFormulas(dataset, {
      formulas,
      filter: undefined,
      fields: [],
      context: bound,
      policy: "leave-out",
    });
  const resolve = planner && "resolve" in planner ? planner.resolve : undefined;
  return (text, at) => {
    const planned = dataset.planSubexpression(text, at, {
      context: bound,
      formula: resolve,
    });
    if (!planned) return undefined;
    const { valueType, member, names } = planned;
    if (!member) return { valueType };
    return {
      valueType,
      members: (names ?? recordMemberNames()).flatMap((name) => {
        const type = member(name);
        return type === undefined ? [] : [{ name, valueType: type }];
      }),
    };
  };
}
