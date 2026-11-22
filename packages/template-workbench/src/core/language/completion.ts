import type {
  Completion,
  CompletionContext,
  CompletionResult,
} from "@codemirror/autocomplete";
import { isolateHistory } from "@codemirror/commands";
import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { regex } from "arkregex";

import { syntaxCompletion } from "./field-popup.ts";
import type { CompletionPresentation } from "./field-popup.ts";
import { pairingContext } from "./pairing-context.ts";
import { expressionBrackets, addPair, pairingState } from "./pairing-state.ts";
import { completionEdit, suggestions } from "./suggestions.ts";
import type {
  CompletionEdit,
  Suggestion,
  SuggestionConfig,
  SuggestionResult,
} from "./suggestions.ts";

export function applyTemplateCompletion(
  view: EditorView,
  result: SuggestionResult,
  option: Suggestion,
): boolean {
  if (option.resolveInsert) {
    const source = view.state.doc.toString();
    const { insert, start } = option.resolveInsert;
    start(insert, (text) => {
      if (text === null || view.state.doc.toString() !== source) return;
      applyTemplateCompletion(view, result, {
        ...option,
        insert: text,
        resolveInsert: undefined,
      });
    });
    return false;
  }
  const edit = completionEdit(view.state.doc.toString(), result, option);
  const effects = snippetPairs(edit, result, option);
  const previous = view.state
    .field(pairingState, false)
    ?.find((pair) => pair.from === result.range.from);
  const close = previous?.close ?? (result.language === "eta" ? "%>" : "}}");
  if (
    !result.expression &&
    result.range.kind === "output" &&
    edit.insert.endsWith(close) &&
    (!result.range.closed || previous)
  ) {
    const from = result.range.from;
    const closeFrom = edit.from + edit.insert.length - close.length;
    const source = view.state.doc.toString();
    let openTo = from + 2;
    if (source[openTo] === "-" || source[openTo] === "_") openTo++;
    if (
      result.language === "eta" &&
      (source[openTo] === "=" || source[openTo] === "~")
    )
      openTo++;
    effects.push(
      addPair.of({
        from,
        open: source.slice(from, openTo),
        closeFrom,
        close,
        padding: edit.insert.at(-3) === " " ? closeFrom - 1 : undefined,
      }),
    );
  }
  view.dispatch({
    effects,
    changes: { from: edit.from, to: edit.to, insert: edit.insert },
    selection: { anchor: edit.anchor },
    annotations: isolateHistory.of("full"),
    userEvent: "input.complete",
  });
  return edit.continue;
}

export type SuggestionSource = (position: number) => SuggestionConfig | null;

export type { CompletionPresentation } from "./field-popup.ts";

export function templateCompletion(
  read: SuggestionSource,
  presentation: CompletionPresentation = {},
): Extension {
  return syntaxCompletion(
    (context) => completionAt(context, read),
    presentation,
  );
}

const suggestionOf = new WeakMap<Completion, Suggestion>();

export function completionSuggestion(
  completion: Completion,
): Suggestion | undefined {
  return suggestionOf.get(completion);
}

function completionAt(
  context: CompletionContext,
  read: SuggestionSource,
): CompletionResult | null {
  const config = read(context.pos);
  if (!config) return null;
  const result = suggestions(context.state.doc.toString(), context.pos, config);
  if (!result || result.options.length === 0) return null;
  return {
    from: result.from,
    to: result.to,
    options: result.options.map((suggestion) => {
      const completion: Completion = {
        ...option(suggestion),
        apply: (view) => {
          applyTemplateCompletion(view, result, suggestion);
        },
      };
      suggestionOf.set(completion, suggestion);
      return completion;
    }),
    filter: false,
  };
}

function option(suggestion: Suggestion): Completion {
  return {
    label: suggestion.label,
    apply: suggestion.insert,
    type: suggestion.category,
    ...(suggestion.type === undefined ? {} : { detail: suggestion.type }),
    ...(suggestion.syntax
      ? {
          info: [suggestion.detail, suggestion.syntax, suggestion.example]
            .filter(Boolean)
            .join("\n\n"),
        }
      : {}),
  };
}

function snippetPairs(
  edit: CompletionEdit,
  result: SuggestionResult,
  option: Suggestion,
) {
  const effects = [];
  if (option.from === result.range.from) {
    const delimiters = regex(
      "(?<open>\\{[{%]-?|<%[-_]?[=~]?)(?<body>[\\s\\S]*?)(?<close>-?%}|-?}}|[-_]?%>)",
      "g",
    );
    let match;
    while ((match = delimiters.exec(edit.insert))) {
      const from = edit.from + match.index;
      const { open, body, close } = match.groups;
      const closeFrom = from + open.length + body.length;
      effects.push(
        addPair.of({
          from,
          open,
          closeFrom,
          close,
          padding: body.endsWith(" ") ? closeFrom - 1 : undefined,
        }),
      );
    }
  }
  if (option.category === "loop" || option.category === "annotation-helper") {
    const source = result.expression
      ? edit.insert
      : option.category === "annotation-helper"
        ? `<% ${edit.insert}`
        : edit.insert;
    const prefix = source.length - edit.insert.length;
    const stack: { from: number; open: string; close: string }[] = [];

    for (let index = 0; index < edit.insert.length; index++) {
      const char = edit.insert[index]!;
      if (
        pairingContext(source, index + prefix, {
          language: result.language,
          mode: result.expression ? "expression" : undefined,
        }) !== "code"
      )
        continue;
      if (
        effects.some(
          ({ value: pair }) =>
            (index + edit.from >= pair.from &&
              index + edit.from < pair.from + pair.open.length) ||
            (index + edit.from >= pair.closeFrom &&
              index + edit.from < pair.closeFrom + pair.close.length),
        )
      )
        continue;
      const close = expressionBrackets[char];
      if (char === "'" || char === '"') {
        const from = index;
        while (++index < edit.insert.length) {
          if (edit.insert[index] === "\\") index++;
          else if (edit.insert[index] === char) break;
        }
        if (index < edit.insert.length)
          effects.push(
            addPair.of({
              from: edit.from + from,
              open: char,
              closeFrom: edit.from + index,
              close: char,
            }),
          );
      } else if (close)
        stack.push({ from: edit.from + index, open: char, close });
      else if (stack.at(-1)?.close === char) {
        effects.push(
          addPair.of({ ...stack.pop()!, closeFrom: edit.from + index }),
        );
      }
    }
  }
  return effects;
}
