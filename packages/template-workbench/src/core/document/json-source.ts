import { invertedEffects } from "@codemirror/commands";
import { ChangeSet, StateEffect } from "@codemirror/state";
import { applyEdits, createScanner, format, parse } from "jsonc-parser";
import type { ParseError, Edit } from "jsonc-parser";

import { yamlValue } from "./scalar-source.ts";

const tokenKind = { eof: 17, whitespace: 15, lineBreak: 14 };

export function jsonLayout(source: string, pretty: boolean) {
  let edits: Edit[];
  if (pretty) {
    edits = format(source, undefined, {
      insertSpaces: true,
      tabSize: 2,
      eol: "\n",
    });
  } else {
    const errors: ParseError[] = [];
    parse(source, errors, {
      disallowComments: true,
      allowTrailingComma: false,
    });
    const scanner = createScanner(source);
    edits = [];
    for (
      let token: number = scanner.scan();
      token !== tokenKind.eof;
      token = scanner.scan()
    ) {
      if (token === tokenKind.whitespace || token === tokenKind.lineBreak) {
        const previous = edits.at(-1);
        if (
          previous &&
          previous.offset + previous.length === scanner.getTokenOffset()
        ) {
          previous.length += scanner.getTokenLength();
        } else
          edits.push({
            offset: scanner.getTokenOffset(),
            length: scanner.getTokenLength(),
            content: errors.length ? " " : "",
          });
      }
    }
  }
  return {
    text: applyEdits(source, edits),
    changes: ChangeSet.of(
      edits.map((edit) => ({
        from: edit.offset,
        to: edit.offset + edit.length,
        insert: edit.content,
      })),
      source.length,
    ),
  };
}

export function ruleDisplay(source: string, prefix: string): string {
  if (!isJson(source)) {
    const value = yamlValue(source, prefix);
    if (value !== undefined) return JSON.stringify(value, null, 2);
  }
  return jsonLayout(source, true).text;
}

export function isJson(source: string): boolean {
  try {
    JSON.parse(source);
    return true;
  } catch {
    return false;
  }
}

export function jsonPosition(source: string, target: string, position: number) {
  const compact = jsonLayout(source, false);
  const expanded = jsonLayout(target, false);
  return expanded.changes.invertedDesc.mapPos(
    Math.min(compact.changes.mapPos(position, 1), expanded.text.length),
    1,
  );
}

type JsonDraft = { text: string; head: number };
export const jsonSliceEdit = StateEffect.define<{
  id: string;
  before: JsonDraft;
  after: JsonDraft;
}>();

export const jsonSliceHistory = invertedEffects.of((transaction) =>
  transaction.effects.toReversed().flatMap((effect) =>
    effect.is(jsonSliceEdit)
      ? [
          jsonSliceEdit.of({
            id: effect.value.id,
            before: effect.value.after,
            after: effect.value.before,
          }),
        ]
      : [],
  ),
);
