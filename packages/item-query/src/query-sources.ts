import { Effect } from "effect";

import {
  readCollectionPaths,
  readFieldVocabulary,
} from "@zotlit/db/item-query";
import type { CollectionPaths, FieldVocabulary } from "@zotlit/db/item-query";

import type { CandidateSources } from "./candidate-plan.ts";
import {
  expressionUse,
  isMissing,
  missingCustomField,
  missingFault,
} from "./custom-field-uses.ts";
import type { ExpressionUse } from "./custom-field-uses.ts";
import type { QueryDataset } from "./dataset.ts";
import { ItemQueryError } from "./error.ts";
import type { ItemQueryErrorLocation } from "./error.ts";
import type { FormulaSourceCheck } from "./formulas.ts";
import type { LoadRequest } from "./record-loader.ts";
import type { ItemQueryRequest, TargetLibrary } from "./request.ts";

export const openQuerySources = Effect.sync(() => {
  let fields: FieldVocabulary | undefined;
  const paths = new Map<number, CollectionPaths>();
  const readVocabulary = Effect.fnUntraced(function* () {
    if (!fields) fields = yield* readFieldVocabulary();
    return fields;
  });
  const collectionPaths = Effect.fnUntraced(function* (library: TargetLibrary) {
    const found = paths.get(library.libraryID);
    if (found) return found;
    const loaded = yield* readCollectionPaths(library);
    paths.set(library.libraryID, loaded);
    return loaded;
  });
  const checkCustomFields = Effect.fnUntraced(function* (
    plan: LoadRequest<unknown>,
  ) {
    const { dataset, filter, paths, group, formulas = [] } = plan;
    if (
      !filter?.customFields.length &&
      !formulas.some((formula) => formula.plan.customFields.length) &&
      !paths.some((path) => path.customField !== null) &&
      !(group && group.customField !== null)
    )
      return;
    const vocabulary = yield* readVocabulary();
    const known = new Set(vocabulary.customFieldNames);
    const expressionUses = (
      uses: NonNullable<typeof filter>["customFields"],
      at: Pick<ItemQueryErrorLocation, "argument" | "path">,
      argumentText: string,
    ) =>
      uses.map((use): CustomFieldUse => {
        const { at: span, ...read } = expressionUse(use, known);
        return { ...read, location: { ...at, span }, argumentText };
      });
    const customFields: CustomFieldUse[] = [
      ...expressionUses(
        filter?.customFields ?? [],
        { argument: "filter" },
        plan.query.filter ?? "",
      ),
      ...paths.flatMap(({ customField: name, text }): CustomFieldUse[] =>
        name === null
          ? []
          : [
              {
                name,
                bare: false,
                location: {
                  argument: "fields",
                  index: plan.query.fields.indexOf(text),
                  path: `fields[${plan.query.fields.indexOf(text)}]`,
                },
                argumentText: JSON.stringify(plan.query.fields),
              },
            ],
      ),
      ...(group && group.customField !== null
        ? [
            {
              name: group.customField,
              bare: false,
              location: {
                argument: "group" as const,
                span: { from: 0, to: group.text.length },
              },
              argumentText: group.text,
            },
          ]
        : []),
      ...formulas.flatMap((formula) =>
        expressionUses(
          formula.plan.customFields,
          { argument: "formulas", path: formula.name },
          formula.text,
        ),
      ),
    ];
    const missing = customFields.find((use) => isMissing(use, known));
    if (missing) {
      return yield* unknownCustomField(
        dataset,
        vocabulary.customFieldNames,
        missing,
      );
    }
  });
  const formulaSourceCheck = Effect.fnUntraced(function* (
    request: Pick<ItemQueryRequest, "formulas" | "onFormulaFault">,
  ) {
    if (
      request.onFormulaFault !== "leave-out" ||
      Object.keys(request.formulas ?? {}).length === 0
    )
      return undefined;
    const { customFieldNames } = yield* readVocabulary();
    const check: FormulaSourceCheck = (plan) =>
      missingCustomField(plan, customFieldNames);
    return check;
  });
  const sources = {
    vocabulary: readVocabulary,
    collectionPaths,
    checkCustomFields,
    formulaSourceCheck,
    candidateContext: (library: TargetLibrary): CandidateSources => ({
      library,
      vocabulary: fields ?? null,
      collectionPaths: paths.get(library.libraryID),
    }),
  };
  return sources;
});
export type QuerySources = Effect.Success<typeof openQuerySources>;

interface CustomFieldUse extends Omit<ExpressionUse, "at"> {
  readonly location: ItemQueryErrorLocation;
  readonly argumentText?: string;
}

function unknownCustomField(
  dataset: QueryDataset,
  names: readonly string[],
  use: CustomFieldUse,
): Effect.Effect<never, ItemQueryError> {
  const { location, argumentText } = use;
  return Effect.fail(
    new ItemQueryError({
      dataset,
      location,
      ...(argumentText === undefined ? {} : { argumentText }),
      fault: missingFault(names, use, location.span ?? { from: 0, to: 0 }),
    }),
  );
}
