import { composeFilterTree } from "@zotlit/filter-expression";
import { planItemFilter } from "@zotlit/item-query";
import { readerText } from "@zotlit/obsidian-kit/reader-diagnostic.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { runtime } from "@zotlit/plugin-messages/runtime.ts";
import type { MatchTree } from "@zotlit/templates/facade";
import { ITEM_TYPES } from "@zotlit/zotero-types/item-types";

export function itemTypeLabel(name: string): string {
  const entry = ITEM_TYPES.find((itemType) => itemType.name === name);
  if (!entry) return name;
  return runtime.getLocale() === "zh-CN"
    ? entry.labels["zh-CN"]
    : entry.labels["en-US"];
}

export type ProfileMatch =
  | { state: "absent"; summary: string }
  | { state: "all"; tree: MatchTree; summary: string }
  | { state: "evaluable"; tree: MatchTree; filter: string; summary: string }
  | {
      state: "unevaluable";
      tree: MatchTree;
      problem: string;
      summary: string;
    };

export function describeMatch(tree: MatchTree): string {
  return composeFilterTree(tree).text;
}

export function compileProfileMatch(tree: MatchTree | undefined): ProfileMatch {
  if (tree === undefined)
    return {
      state: "absent",
      get summary() {
        return m.profile_match_absent();
      },
    };
  const { text } = composeFilterTree(tree);
  if (text.trim() === "true")
    return {
      state: "all",
      tree,
      get summary() {
        return m.profile_match_all();
      },
    };
  const planned = planItemFilter(text);
  if (!("matches" in planned)) {
    const problem = readerText(planned);
    return {
      state: "unevaluable",
      tree,
      problem,
      get summary() {
        return m.profile_match_problem({ problem });
      },
    };
  }
  return { state: "evaluable", tree, filter: text, summary: text };
}
