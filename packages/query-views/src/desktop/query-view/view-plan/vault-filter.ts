import type { FilterLocation } from "#core/query-view/query-file.ts";
import type {
  ConditionFault,
  VaultCondition,
  VaultRead,
} from "#core/query-view/view-plan/filter-split.ts";
import type { VaultValue } from "#desktop/query-view/table-notes.ts";
import type { ViewDiagnostic } from "#obsidian/query-view/reader-failure.ts";

import { planItemFilter } from "@zotlit/item-query";
import * as m from "@zotlit/plugin-messages/messages.ts";
import type { Span } from "@zotlit/template-workbench/core/language/index.ts";

export interface VaultFilterNotes {
  itemKeys(): Iterable<string>;
  read(itemKey: string, name: string): VaultValue;
}

export type VaultFilter =
  | { readonly condition: string | null }
  | {
      readonly fault: {
        readonly at: FilterLocation | ConditionFault;
        readonly diagnostic: ViewDiagnostic;
      };
    };

export interface VaultFilterInput {
  readonly conditions: readonly VaultCondition[];
  readonly stranded: readonly FilterLocation[];
  readonly notes: VaultFilterNotes;
  readonly keyPath?: string;
}

export function planVaultFilter({
  conditions,
  stranded,
  notes,
  keyPath = "indexedKey",
}: VaultFilterInput): VaultFilter {
  const [nested] = stranded;
  if (nested)
    return fault(nested, {
      code: "vault-filter-nested",
      message: m.query_view_vault_filter_nested(),
      hint: m.query_view_vault_filter_nested_hint(),
    });
  if (conditions.length === 0) return { condition: null };
  const planned: {
    text: string;
    reads: readonly VaultRead[];
    at: FilterLocation;
    within: VaultCondition["within"];
  }[] = [];
  for (const { text, section, path, reads, within } of conditions) {
    if (reads === null)
      return fault(
        { section, path },
        {
          code: "vault-filter-mixed",
          message: m.query_view_vault_filter_mixed(),
          hint: m.query_view_vault_filter_mixed_hint(),
        },
      );
    planned.push({ text, reads, at: { section, path }, within });
  }
  const tests = new Map<string, boolean>();
  const holds = (value: (name: string) => unknown) => {
    for (const { text, reads, at, within } of planned) {
      const filled = substitute(text, reads, value);
      let matched = tests.get(filled.text);
      if (matched === undefined) {
        const filter = planItemFilter(filled.text);
        if ("code" in filter) {
          const span = filter.location?.span;
          const place = span && filled.source(span);
          return {
            at: place
              ? {
                  ...at,
                  fault: {
                    text: within.text,
                    span: {
                      from: within.offset + place.from,
                      to: within.offset + place.to,
                    },
                  },
                }
              : at,
            diagnostic: {
              code: filter.code,
              message: filter.message,
              hint: filter.hint,
            },
          };
        }
        matched = filter.matches({} as never);
        tests.set(filled.text, matched);
      }
      if (!matched) return false;
    }
    return true;
  };
  const withoutNote = holds(() => null);
  if (typeof withoutNote !== "boolean") return { fault: withoutNote };
  const listed: string[] = [];
  for (const key of notes.itemKeys()) {
    const passes = holds((name) => {
      const read = notes.read(key, name);
      return read.note ? read.value : null;
    });
    if (typeof passes !== "boolean") return { fault: passes };
    if (passes !== withoutNote) listed.push(key);
  }
  listed.sort();
  if (withoutNote && listed.length === 0) return { condition: null };
  const list = `[${listed.map((key) => JSON.stringify(key)).join(", ")}].contains(${keyPath})`;
  return { condition: withoutNote ? `!${list}` : list };
}

function fault(
  { section, path }: FilterLocation,
  diagnostic: ViewDiagnostic,
): VaultFilter {
  return { fault: { at: { section, path }, diagnostic } };
}

function substitute(
  text: string,
  reads: readonly VaultRead[],
  value: (name: string) => unknown,
): { text: string; source(span: Span): Span } {
  let out = "";
  let last = 0;
  const values: { from: number; to: number; read: VaultRead }[] = [];
  for (const read of [...reads].sort((a, b) => a.from - b.from)) {
    out += text.slice(last, read.from);
    const from = out.length;
    out += literal(value(read.name));
    values.push({ from, to: out.length, read });
    last = read.to;
  }
  out += text.slice(last);
  const back = (at: number, side: "from" | "to") => {
    let shift = 0;
    for (const put of values) {
      if (at < put.from || (side === "to" && at === put.from)) break;
      if (at < put.to || (side === "to" && at === put.to))
        return put.read[side];
      shift = put.read.to - put.to;
    }
    return at + shift;
  };
  return {
    text: out,
    source: ({ from, to }) => ({
      from: back(from, "from"),
      to: back(to, "to"),
    }),
  };
}

function literal(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number")
    return Number.isFinite(value) ? `(${value})` : "null";
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.map(literal).join(", ")}]`;
  return "null";
}
