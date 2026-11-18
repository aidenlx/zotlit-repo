// A Profile Match as settings and creation read it: the Filter Tree a Profile
// document stores, planned as a filter of the Items dataset.
import { composeFilterTree } from "@zotlit/filter-expression";
import { planItemFilter } from "@zotlit/item-query";
import { readerText } from "@zotlit/obsidian-kit/reader-diagnostic.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { runtime } from "@zotlit/plugin-messages/runtime.ts";
import type { MatchTree } from "@zotlit/templates/facade";
import { ITEM_TYPES } from "@zotlit/zotero-types/item-types";

/** The label of a built-in Zotero item type in the active locale. */
export function itemTypeLabel(name: string): string {
  const entry = ITEM_TYPES.find((itemType) => itemType.name === name);
  if (!entry) return name;
  return runtime.getLocale() === "zh-CN"
    ? entry.labels["zh-CN"]
    : entry.labels["en-US"];
}

/**
 * The Match of a Profile document:
 * - `absent`: the document names no Match.
 * - `all`: the Match holds for every Item.
 * - `evaluable`: the Match holds for the Items that `filter` selects.
 * - `unevaluable`: the Match has a mistake, which `problem` tells.
 */
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

/** A stored Match as one Filter Expression. */
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
  // A Match with no condition, such as an empty "All" group, or `true`.
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
