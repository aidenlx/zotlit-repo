import type { Completion, CompletionContext } from "@codemirror/autocomplete";
import { startCompletion } from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

import {
  isIdentifierName,
  isMemberName,
  parser,
} from "@zotlit/filter-expression";
import {
  GLOBAL_FUNCTIONS,
  IF_FUNCTION,
  fieldSearchTerms,
} from "@zotlit/item-query";
import type { QueryDataset } from "@zotlit/item-query";

import { keyCompletions } from "./expression-keys.ts";
import { memberCompletions, namespaceAccessAt } from "./expression-members.ts";
import type {
  ExpressionCompletionResult,
  ExpressionField,
  ExpressionName,
  ExpressionOption,
  ExpressionVocabulary,
} from "./expression-options.ts";
import {
  fieldOption,
  noteOf,
  optionTexts,
  ranked,
  rankedOptions,
  signature,
} from "./expression-options.ts";
import type { CompletionPresentation } from "./field-popup.ts";
import { syntaxCompletion } from "./field-popup.ts";
import { bindsNames, boundNameOptions } from "./list-scope.ts";

export type {
  ExpressionCompletionResult,
  ExpressionField,
  ExpressionOption,
  ExpressionVocabulary,
} from "./expression-options.ts";

const LITERALS = new Set(["String", "RegExp", "RealNumber", "Escape"]);

const FUNCTIONS: readonly ExpressionOption[] = [
  ["if", IF_FUNCTION] as const,
  ...GLOBAL_FUNCTIONS,
].map(([name, definition]) => ({
  label: name,
  insert: `${name}()`,
  caret: name.length + 1,
  kind: "function",
  type: signature(name, definition),
  note: definition.description,
}));

function namespaced(
  namespace: string,
  { name, label }: ExpressionName,
): ExpressionOption {
  const path = `${namespace}.${name}`;
  return {
    label: path,
    insert: isMemberName(name) ? path : `${namespace}[${JSON.stringify(name)}]`,
    kind: "namespace",
    ...noteOf(path, label),
  };
}

function entries(vocabulary: ExpressionVocabulary): ExpressionOption[] {
  return [
    ...vocabulary.fields.map(fieldOption),
    ...vocabulary.context.map((name) => namespaced("this", { name })),
    ...vocabulary.formulas.map((formula) => namespaced("formula", formula)),
    ...(vocabulary.vault ?? []).map((name) => namespaced("vault", name)),
    ...FUNCTIONS,
  ];
}

export function expressionCompletions(
  source: string,
  pos: number,
  {
    vocabulary,
    explicit = false,
  }: { vocabulary: ExpressionVocabulary; explicit?: boolean },
): ExpressionCompletionResult | null {
  const inner = parser.parse(source).resolveInner(pos, -1);
  const caret = { inner, pos, source };
  const keys = keyCompletions(caret, vocabulary);
  if (keys !== undefined) return keys;
  for (let node: SyntaxNode | null = inner; node; node = node.parent)
    if (LITERALS.has(node.name)) return null;
  const members = memberCompletions(caret, vocabulary);
  if (members !== undefined) return members;
  const path = namespaceAccessAt(caret);
  if (path) {
    const prefix = `${path.namespace}.`;
    const options = ranked(
      entries(vocabulary).filter(
        (option) =>
          option.kind === "namespace" && option.label.startsWith(prefix),
      ),
      prefix + path.typed,
      optionTexts,
    );
    return options.length === 0
      ? null
      : { from: path.from, to: path.to, options };
  }
  const word =
    inner.name === "Identifier" && inner.from < pos ? inner : undefined;
  const from = word?.from ?? pos;
  const to = word?.to ?? pos;
  const query = source.slice(from, pos);
  const bound = boundNameOptions(caret);
  if (query === "" && !explicit && bound.length === 0) return null;
  const options = rankedOptions([...bound, ...entries(vocabulary)], query);
  return options.length === 0 ? null : { from, to, options };
}

export function datasetExpressionFields(
  dataset: Pick<QueryDataset, "id" | "names" | "planFilter">,
  label: (path: string) => string | undefined = () => undefined,
): ExpressionField[] {
  let typed = typedFields.get(dataset);
  if (!typed) {
    typed = dataset.names.flatMap((path): ExpressionField[] => {
      if (!isIdentifierName(path)) return [];
      const plan = dataset.planFilter(path);
      if ("kind" in plan) return [];
      const type = plan.root.valueType;
      if (type === "null") return [];
      return [
        {
          path,
          ...(type === "unknown" ? {} : { type }),
          searchTerms: fieldSearchTerms(dataset.id, path),
        },
      ];
    });
    typedFields.set(dataset, typed);
  }
  return typed.map((field) => {
    const named = label(field.path);
    return named === undefined ? field : { ...field, label: named };
  });
}

const typedFields = new WeakMap<object, ExpressionField[]>();

const optionOf = new WeakMap<Completion, ExpressionOption>();

export function expressionOption(
  completion: Completion,
): ExpressionOption | undefined {
  return optionOf.get(completion);
}

type ApplyCompletion = Extract<
  Completion["apply"],
  (...args: never[]) => unknown
>;

function completionAt(
  context: CompletionContext,
  read: () => ExpressionVocabulary | null | undefined,
) {
  const vocabulary = read();
  if (!vocabulary) return null;
  const result = expressionCompletions(
    context.state.doc.toString(),
    context.pos,
    { vocabulary, explicit: context.explicit },
  );
  if (!result) return null;
  return {
    from: result.from,
    to: result.to,
    filter: false,
    options: result.options.map((option) => {
      const completion: Completion = {
        label: option.label,
        type: option.kind,
        apply: (...[view, , from, to]: Parameters<ApplyCompletion>) => {
          view.dispatch({
            changes: { from, to, insert: option.insert },
            selection: {
              anchor: from + (option.caret ?? option.insert.length),
            },
            userEvent: "input.complete",
          });
          if (option.kind === "method" && bindsNames(option.label))
            startCompletion(view);
        },
      };
      optionOf.set(completion, option);
      return completion;
    }),
  };
}

export function filterExpressionCompletion(
  read: () => ExpressionVocabulary | null | undefined,
  presentation: CompletionPresentation = {},
): Extension {
  return syntaxCompletion(
    (context) => completionAt(context, read),
    presentation,
  );
}
