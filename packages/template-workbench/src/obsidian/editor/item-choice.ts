import type { AnnotationExample } from "#core/render/index.ts";
import type { WorkbenchItemChoice } from "#obsidian/workbench-ui/index.tsx";
import type {
  ChooserScope,
  WorkbenchSuggesterRequest,
} from "#obsidian/workbench-ui/suggester.ts";
import { useAtomValue } from "@effect/atom-react";
import { Effect } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";

import { isChildItemFields } from "@zotlit/db";
import { viewRuntime } from "@zotlit/obsidian-kit/view-atoms.ts";
import { itemSummary } from "@zotlit/plugin-kernel/item-summary.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { awaitItem } from "@zotlit/plugin-services/obsidian/item-lookup/search-modal.ts";
import type { ItemSearchDeps } from "@zotlit/plugin-services/obsidian/item-lookup/search-modal.ts";
import {
  DEFAULT_LIMIT,
  ItemLookup,
} from "@zotlit/plugin-services/obsidian/item-lookup/service.ts";
import type { SearchHit } from "@zotlit/plugin-services/obsidian/item-lookup/service.ts";

import {
  getSampleItemType,
  SAMPLE_ITEM_CHOICES,
} from "#core/editor/selection-data.ts";
import { SAMPLE_ANNOTATIONS } from "#core/render/index.ts";
import { annotationOption } from "#obsidian/workbench-ui/index.tsx";
import { chooseWorkbenchOption } from "#obsidian/workbench-ui/suggester.ts";

type AnnotationChoice = Pick<AnnotationExample, "id" | "root">;

const itemChoices = (hits: readonly SearchHit[]): WorkbenchItemChoice[] =>
  hits.flatMap(({ item }) =>
    isChildItemFields(item.fields)
      ? []
      : [
          {
            id: item.indexedKey,
            title: itemSummary(item, item.fields).formatted,
          },
        ],
  );

const NO_RECENT: readonly WorkbenchItemChoice[] = [];

export const recentItemChoices: Effect.Effect<
  readonly WorkbenchItemChoice[],
  never,
  ItemLookup
> = Effect.flatMap(ItemLookup, (lookup) =>
  lookup.search("", { limit: 3 }),
).pipe(Effect.map((hits) => itemChoices(hits)));

export const recentItemsAtom = viewRuntime.atom(recentItemChoices);

export function useRecentItems(): readonly WorkbenchItemChoice[] {
  const result = useAtomValue(recentItemsAtom);
  return AsyncResult.isSuccess(result) ? result.value : NO_RECENT;
}

export const workbenchItemChoice = (
  scope: ChooserScope,
  deps: ItemSearchDeps,
  selected?: WorkbenchItemChoice,
): Effect.Effect<WorkbenchItemChoice | null, never, ItemLookup> =>
  Effect.gen(function* () {
    const lookup = yield* ItemLookup;
    const recent = yield* recentItemChoices;
    const choices = [...SAMPLE_ITEM_CHOICES, ...recent];
    const retained =
      selected && !choices.some(({ id }) => id === selected.id)
        ? [selected]
        : [];
    const found = new Map<string, WorkbenchItemChoice>();
    const session = yield* lookup.openSession;
    const request: WorkbenchSuggesterRequest = {
      window: scope.window,
      title: m.workbench_choose_item(),
      selected: selected?.id,
      groups: [
        {
          label: "",
          options: [
            {
              id: "search-zotero",
              label: m.workbench_search_zotero(),
              icon: "search",
            },
          ],
        },
        ...retained.map((item) => ({
          label: m.workbench_selected_label(),
          options: [{ id: item.id, label: item.title ?? item.id }],
        })),
        {
          label: m.workbench_sample_examples(),
          options: SAMPLE_ITEM_CHOICES.map((item) => ({
            id: item.id,
            label: sampleTypeLabel(item.id),
            hint: item.title ?? undefined,
          })),
        },
        {
          label: m.workbench_recently_updated(),
          options: recent.map((item) => ({
            id: item.id,
            label: item.title ?? item.id,
          })),
        },
      ],
      search: {
        run: scope.run,
        items: (query) =>
          session.search(query, { limit: DEFAULT_LIMIT }).pipe(
            Effect.map((hits) =>
              itemChoices(hits).map((choice) => {
                found.set(choice.id, choice);
                return { id: choice.id, label: choice.title ?? choice.id };
              }),
            ),
          ),
      },
    };
    const id = yield* chooseWorkbenchOption(scope.app, request);
    if (id === "search-zotero") return yield* workbenchItemSearch(deps);
    return (
      [...retained, ...choices].find((item) => item.id === id) ??
      (id ? found.get(id) : null) ??
      null
    );
  }).pipe(Effect.scoped);

export const workbenchItemSearch = (
  deps: ItemSearchDeps,
): Effect.Effect<WorkbenchItemChoice | null> =>
  awaitItem(deps, m.template_data_explorer_pick_placeholder()).pipe(
    Effect.map((hit) => (hit ? (itemChoices([hit])[0] ?? null) : null)),
  );

export const workbenchAnnotationChoice = (
  scope: ChooserScope,
  current: readonly AnnotationChoice[],
  selected: string | null,
): Effect.Effect<string | null> => {
  const options = (examples: readonly AnnotationChoice[]) =>
    examples.map((example) => {
      const option = annotationOption(example);
      return {
        id: option.value,
        label: option.label,
        hint: option.description,
      };
    });
  return chooseWorkbenchOption(scope.app, {
    window: scope.window,
    title: m.workbench_choose_annotation(),
    selected: selected ?? undefined,
    groups: [
      {
        label: m.workbench_annotation_from_item(),
        options: options(current),
        empty: m.workbench_annotation_empty(),
      },
      {
        label: m.workbench_sample_examples(),
        options: options(SAMPLE_ANNOTATIONS),
      },
    ],
  });
};

export function sampleTypeLabel(id: string): string {
  switch (getSampleItemType(id)) {
    case "journalArticle":
      return m.workbench_sample_type_journal_article();
    case "conferencePaper":
      return m.workbench_sample_type_conference_paper();
    case "book":
      return m.workbench_sample_type_book();
    case "thesis":
      return m.workbench_sample_type_thesis();
    default:
      return m.workbench_example_item();
  }
}
