import { FORMULA_SEGMENT } from "@zotlit/item-query";
import type { ContextRecord, QueryDataset } from "@zotlit/item-query";

import type { ExpressionVocabulary } from "./expression-options.ts";
import { datasetCustomFields, VAULT_SEGMENT } from "./expression-options.ts";
import { datasetReceiver } from "./expression-receiver.ts";
import { datasetExpressionFields } from "./filter-expression-completion.ts";

export function datasetVocabulary(
  engine: QueryDataset,
  {
    label,
    context = [],
    formulas = {},
    vault,
    custom,
  }: {
    label: (path: string) => string | undefined;
    context?: readonly ContextRecord[];
    formulas?: Readonly<Record<string, string>>;
    vault?: readonly string[];
    custom?: readonly string[];
  },
): ExpressionVocabulary {
  const named = (name: string, id: string) => {
    const given = label(id);
    return given === undefined ? { name } : { name, label: given };
  };
  return {
    fields: datasetExpressionFields(engine, label),
    receiver: datasetReceiver(engine, { context, formulas, label }),
    context,
    formulas: Object.keys(formulas).map((name) =>
      named(name, `${FORMULA_SEGMENT}.${name}`),
    ),
    ...(vault && {
      vault: vault.map((name) => named(name, `${VAULT_SEGMENT}.${name}`)),
    }),
    ...(custom && { custom: datasetCustomFields(engine, custom) }),
  };
}
