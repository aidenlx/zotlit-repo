import type { QueryFileView } from "#core/query-view/query-file.ts";
import type { CSSProperties } from "react";

import { Chooser } from "@zotlit/obsidian-kit/components/chooser.tsx";
import { Slider } from "@zotlit/obsidian-kit/components/obsidian/slider.tsx";
import { cn } from "@zotlit/obsidian-kit/utils.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import type { QueryLayout } from "./layouts.ts";
import { useQueryViewState } from "./model.ts";
import {
  RecordCell,
  RecordGroupHeading,
  useRecordGroups,
} from "./record-rows.tsx";
import type { QueryView } from "./view.tsx";

export const CARDS_LAYOUT: QueryLayout = {
  type: "cards",
  datasets: ["annotations", "attachments", "items"],
  name: () => m.query_view_layout_cards(),
  icon: "layout-grid",
};

export const CARD_SIZE = { min: 50, max: 800, step: 10, default: 200 };

export interface CardsLayoutOptions {
  readonly cardSize: number;
}

export function cardsLayoutOptions(
  view: QueryFileView | null,
): CardsLayoutOptions {
  const size = view?.source.cardSize;
  return {
    cardSize:
      typeof size === "number" && Number.isFinite(size) && size > 0
        ? Math.min(CARD_SIZE.max, Math.max(CARD_SIZE.min, size))
        : CARD_SIZE.default,
  };
}

export function CardsLayoutFields({
  options,
  set,
}: {
  options: CardsLayoutOptions;
  set: (key: keyof CardsLayoutOptions, value: unknown) => void;
}) {
  return (
    <Chooser.PageField label={m.query_view_card_size()}>
      <Slider
        value={options.cardSize}
        min={CARD_SIZE.min}
        max={CARD_SIZE.max}
        step={CARD_SIZE.step}
        instant
        dynamicTooltip
        data-query-view-option="cardSize"
        onChange={(value) => set("cardSize", value)}
      />
    </Chooser.PageField>
  );
}

const CARD_LINE =
  "zt:truncate zt:leading-6 zt:empty:before:text-faint zt:empty:before:content-['—']";

export function CardsLayout({ view }: { view: QueryView }) {
  const { properties, groups } = useRecordGroups(view);
  const options = cardsLayoutOptions(useQueryViewState(view, (s) => s.view));
  return (
    <div
      className="zt:min-h-0 zt:flex-1 zt:overflow-auto zt:px-3 zt:pt-3 zt:pb-11 zt:in-[.zt-query-note]:pb-3"
      data-query-layout="cards"
    >
      {groups.map((group, groupIndex) => (
        <section
          key={`${groupIndex}\n${group.key ?? ""}`}
          className={cn(
            group.key !== null &&
              "zt:border-b-(length:--border-width) zt:border-(--background-modifier-border) zt:pb-4",
          )}
        >
          <RecordGroupHeading group={group} />
          {!group.collapsed && (
            <div
              role="list"
              className="zt:grid zt:grid-cols-[repeat(auto-fill,minmax(min(100%,var(--zt-card-size)),1fr))] zt:items-start zt:gap-3 zt:py-1"
              style={
                {
                  "--zt-card-size": `${options.cardSize}px`,
                } as CSSProperties
              }
              data-card-size={options.cardSize}
            >
              {group.rows.map((record, index) => {
                const { row, cells } = record;
                const rest = cells.slice(1);
                return (
                  <div
                    key={`${row.indexedKey}\n${index}`}
                    role="listitem"
                    className="zt:flex zt:min-w-0 zt:flex-col zt:gap-2 zt:rounded-md zt:bg-background zt:px-2 zt:pt-2 zt:pb-0.5 zt:shadow-[0_0_0_1px_var(--background-modifier-border)]"
                    data-query-row={row.indexedKey}
                  >
                    {properties.length > 0 && (
                      <div
                        className={cn(
                          "zt:text-base zt:font-[calc(var(--font-weight)+var(--bold-modifier))]",
                          CARD_LINE,
                        )}
                      >
                        <RecordCell
                          record={record}
                          properties={properties}
                          at={0}
                        />
                      </div>
                    )}
                    {rest.map((_, at) => (
                      <div
                        key={properties[at + 1]!.path}
                        className="zt:min-w-0"
                      >
                        <div className="zt:truncate zt:text-xs zt:text-muted-foreground">
                          {properties[at + 1]!.label}
                        </div>
                        <div
                          className={cn(
                            "zt:text-(length:--font-smaller)",
                            CARD_LINE,
                          )}
                        >
                          <RecordCell
                            record={record}
                            properties={properties}
                            at={at + 1}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
