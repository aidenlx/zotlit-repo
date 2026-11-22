import type { QueryFileDataset } from "#core/query-view/query-file.ts";
import { useAtomValue } from "@effect/atom-react";
import { Option } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import { useMemo } from "react";

import type { ContextRecord } from "@zotlit/item-query";
import { datasetVocabulary } from "@zotlit/template-workbench/core/language/index.ts";
import type { ExpressionVocabulary } from "@zotlit/template-workbench/core/language/index.ts";

import { customFieldNamesAtom } from "./atoms.ts";
import { datasetSpec } from "./datasets.ts";
import { useQueryViewState } from "./model.ts";
import { fieldLabel } from "./view-properties.ts";
import type { ViewProperties } from "./view-properties.ts";
import type { QueryView } from "./view.tsx";

import { boundRecords } from "#obsidian/query-view/context-hint.ts";

const NO_CUSTOM: readonly string[] = [];
const noCustomAtom = Atom.make(AsyncResult.success(NO_CUSTOM));

export function useViewCustomFields(reading = true): readonly string[] {
  const read = useAtomValue(reading ? customFieldNamesAtom : noCustomAtom);
  return Option.getOrElse(AsyncResult.value(read), () => NO_CUSTOM);
}

export function expressionVocabulary({
  dataset,
  properties,
  formulas = {},
  context = [],
  vaultNames,
  custom,
}: {
  dataset: QueryFileDataset | undefined;
  properties?: ViewProperties | null;
  formulas?: Readonly<Record<string, string>>;
  context?: readonly ContextRecord[];
  vaultNames?: readonly string[];
  custom?: readonly string[];
}): ExpressionVocabulary {
  return datasetVocabulary(datasetSpec(dataset).engine, {
    label: (path) => properties?.entry(path).label ?? fieldLabel(path),
    formulas,
    context,
    ...(vaultNames && { vault: vaultNames }),
    ...(custom && { custom }),
  });
}

export function useFilterExpressions(
  view: QueryView,
  properties: ViewProperties | null,
  { reading, vaultNames }: { reading: boolean; vaultNames?: readonly string[] },
): (dataset: QueryFileDataset) => ExpressionVocabulary {
  const formulas = useQueryViewState(view, (s) => s.file?.formulas);
  const custom = useViewCustomFields(reading);
  const context = boundRecords(view.contextSource);
  return useMemo(() => {
    const made = new Map<QueryFileDataset, ExpressionVocabulary>();
    return (dataset) => {
      let vocabulary = made.get(dataset);
      if (!vocabulary) {
        vocabulary = expressionVocabulary({
          dataset,
          properties,
          formulas: formulas ?? {},
          context,
          custom,
          ...(dataset === "items" && vaultNames && { vaultNames }),
        });
        made.set(dataset, vocabulary);
      }
      return vocabulary;
    };
  }, [properties, formulas, context, custom, vaultNames]);
}
