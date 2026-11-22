import { fieldSearchTerms, subexpressionTypes } from "@zotlit/item-query";
import type { QueryDataset } from "@zotlit/item-query";

import type {
  ExpressionReceiver,
  ExpressionVocabulary,
} from "./expression-options.ts";
import type { Span } from "./span.ts";

export function datasetReceiver(
  dataset: QueryDataset<any>,
  {
    label,
    ...options
  }: NonNullable<Parameters<typeof subexpressionTypes>[1]> & {
    label?: (path: string) => string | undefined;
  } = {},
): NonNullable<ExpressionVocabulary["receiver"]> {
  const typeAt = subexpressionTypes(dataset, options);
  const read = (text: string, span: Span): ExpressionReceiver | undefined => {
    const planned = typeAt(text, span);
    if (!planned) return undefined;
    const type =
      planned.valueType === "unknown" ? undefined : planned.valueType;
    if (!planned.members) return { type };
    const receiver = text.slice(span.from, span.to).replaceAll(/\s+/g, "");
    return {
      type,
      members: planned.members.flatMap(({ name, valueType }) => {
        if (valueType === "null") return [];
        const path = `${receiver}.${name}`;
        const named = label?.(path);
        return [
          {
            path: name,
            ...(valueType === "unknown" ? {} : { type: valueType }),
            ...(named === undefined || named === path ? {} : { label: named }),
            searchTerms: fieldSearchTerms(dataset.id, path),
          },
        ];
      }),
    };
  };
  let last: { key: string; value: ExpressionReceiver | undefined } | undefined;
  return (source, at) => {
    const key = `${at.from}:${at.to}:${source}`;
    if (last?.key !== key) last = { key, value: read(source, at) };
    return last.value;
  };
}
