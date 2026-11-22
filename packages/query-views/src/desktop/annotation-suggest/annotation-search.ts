import type { QueryHandle } from "#desktop/item-query/handle.ts";
import type {
  QueryViewRow,
  QueryViewValue,
} from "#desktop/item-query/query-view.ts";
import { Effect } from "effect";

import {
  logServices,
  withLogCategory,
  logLevelEnabled,
} from "@zotlit/plugin-kernel/effect-log.ts";
import { searchTokens } from "@zotlit/plugin-services/core/item-lookup/search-text.ts";

import { visibleText } from "#core/item-query/visible-text.ts";

export const ANNOTATION_SEARCH_TOKENS = ["tag", "color", "paper"] as const;

const PAPER_LIMIT = 20;

export interface AnnotationHit {
  key: string;
  attachmentKey: string;
  itemKey: string;
  type: string | null;
  text: string | null;
  comment: string | null;
  color: string | null;
  pageLabel: string | null;
  title: string | null;
  citationKey: string | null;
}

const FIELDS = {
  type: "type",
  text: "text",
  comment: "comment",
  color: "color",
  pageLabel: "pageLabel",
  title: "item.title",
  citationKey: "item.citationKey",
} as const;

const quote = (value: string) => JSON.stringify(value);

function annotationConditions(
  terms: { words: string; tag: readonly string[]; color: readonly string[] },
  field: (name: string) => string,
): string[] {
  const conditions = terms.words
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map(
      (word) =>
        `(${visibleText(field("text"))}.lower().contains(${quote(word)}) || ${visibleText(field("comment"))}.lower().contains(${quote(word)}))`,
    );
  for (const tag of terms.tag)
    conditions.push(`${field("tags")}.contains(${quote(tag)})`);
  if (terms.color.length > 0)
    conditions.push(
      `(${terms.color
        .map((color) =>
          color.startsWith("#")
            ? `${field("color")}.lower() == ${quote(color.toLowerCase())}`
            : `${field("colorName")} == ${quote(color.toLowerCase())}`,
        )
        .join(" || ")})`,
    );
  return conditions;
}

const and = (conditions: readonly string[]) =>
  conditions.length === 0 ? undefined : conditions.join(" && ");

const text = (value: QueryViewValue | undefined): string | null =>
  typeof value === "string" ? value : null;

function toHit(row: QueryViewRow): AnnotationHit {
  const read = (name: keyof typeof FIELDS) => text(row.values[FIELDS[name]]);
  return {
    key: row.indexedKey,
    attachmentKey: row.attachmentIndexedKey!,
    itemKey: row.itemIndexedKey!,
    type: read("type"),
    text: read("text"),
    comment: read("comment"),
    color: read("color"),
    pageLabel: read("pageLabel"),
    title: read("title"),
    citationKey: read("citationKey"),
  };
}

export async function searchAnnotations(
  service: Pick<QueryHandle, "run">,
  query: string,
  { signal, limit }: { signal: AbortSignal; limit: number },
): Promise<AnnotationHit[] | null> {
  if (signal.aborted) return null;
  const { words, tokens } = searchTokens(query, ANNOTATION_SEARCH_TOKENS);
  const terms = { words, ...tokens };
  const papers = await service.run(
    {
      from: "items",
      filter: and([
        `annotations.filter(${and(annotationConditions(terms, (name) => `value.${name}`)) ?? "true"}).length > 0`,
        ...tokens.paper.map((paper) => {
          const lower = quote(paper.toLowerCase());
          return `(title.lower().contains(${lower}) || citationKey.lower() == ${lower})`;
        }),
      ]),
      fields: [],
      sort: [{ field: "lastActivity", direction: "desc" }],
      limit: PAPER_LIMIT,
    },
    signal,
  );
  if (papers.kind !== "result") {
    if (papers.kind === "failed")
      Effect.runSyncWith(logServices)(
        Effect.logWarning("Annotation search failed").pipe(
          Effect.annotateLogs({
            stage: "papers",
            diagnostic: papers.diagnostic,
          }),
          withLogCategory("views", "annotation-suggest"),
        ),
      );
    return null;
  }
  const rank = new Map(
    (papers.result.rows ?? []).map((row, index) => [row.indexedKey, index]),
  );
  if (logLevelEnabled("trace"))
    Effect.runSyncWith(logServices)(
      Effect.logTrace("Annotation search papers").pipe(
        Effect.annotateLogs({ papers: rank.size }),
        withLogCategory("views", "annotation-suggest"),
      ),
    );
  if (rank.size === 0) return [];
  const annotations = await service.run(
    {
      from: "annotations",
      filter: and([
        `[${[...rank.keys()].map(quote).join(", ")}].contains(item.indexedKey)`,
        ...annotationConditions(terms, (name) => name),
      ]),
      fields: Object.values(FIELDS),
      sort: [
        { field: "attachment.indexedKey", direction: "asc" },
        { field: "sortIndex", direction: "asc" },
      ],
      group: "item.indexedKey",
      limit,
    },
    signal,
  );
  if (annotations.kind !== "result") {
    if (annotations.kind === "failed")
      Effect.runSyncWith(logServices)(
        Effect.logWarning("Annotation search failed").pipe(
          Effect.annotateLogs({
            stage: "annotations",
            diagnostic: annotations.diagnostic,
          }),
          withLogCategory("views", "annotation-suggest"),
        ),
      );
    return null;
  }
  return (annotations.result.groups ?? [])
    .toSorted(
      (a, b) =>
        (rank.get(String(a.value)) ?? rank.size) -
        (rank.get(String(b.value)) ?? rank.size),
    )
    .flatMap((group) => group.rows.map(toHit))
    .slice(0, limit);
}
