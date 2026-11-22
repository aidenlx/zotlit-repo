import type { QueryFileView } from "#core/query-view/query-file.ts";
import { useMemo, useState } from "react";

import { Chooser } from "@zotlit/obsidian-kit/components/chooser.tsx";
import {
  Dropdown,
  DropdownItem,
} from "@zotlit/obsidian-kit/components/obsidian/dropdown.tsx";
import { Toggle } from "@zotlit/obsidian-kit/components/obsidian/toggle.tsx";
import { cn } from "@zotlit/obsidian-kit/utils.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { useUniqueId } from "@zotlit/ui";

import { ItemsWindow } from "./items-window.tsx";
import type { DrawnEntry, WindowEntry } from "./items-window.tsx";
import type { QueryLayout } from "./layouts.ts";
import { drawListRow, useListRowHeights } from "./list-row.tsx";
import { useQueryViewState } from "./model.ts";
import {
  HEADING_ESTIMATE,
  RecordGroupHeading,
  groupEntries,
  useRecordGroups,
} from "./record-rows.tsx";
import type { QueryView } from "./view.tsx";

import { LIST_GHOST } from "#core/query-view/virtual-spacers.tsx";

export const LIST_LAYOUT: QueryLayout = {
  type: "list",
  datasets: ["annotations", "attachments", "items"],
  name: () => m.query_view_layout_list(),
  icon: "list",
};

export const LIST_MARKERS = ["bullet", "number", "none"] as const;
export type ListMarker = (typeof LIST_MARKERS)[number];

export interface ListLayoutOptions {
  readonly markers: ListMarker;
  readonly indentProperties: boolean;
  readonly separator: string;
}

export const LIST_LAYOUT_DEFAULTS: ListLayoutOptions = {
  markers: "bullet",
  indentProperties: false,
  separator: ", ",
};

export function listLayoutOptions(
  view: QueryFileView | null,
): ListLayoutOptions {
  const source = view?.source ?? {};
  const markers = source.markers;
  return {
    markers: (LIST_MARKERS as readonly unknown[]).includes(markers)
      ? (markers as ListMarker)
      : LIST_LAYOUT_DEFAULTS.markers,
    indentProperties:
      typeof source.indentProperties === "boolean"
        ? source.indentProperties
        : LIST_LAYOUT_DEFAULTS.indentProperties,
    separator:
      typeof source.separator === "string" && source.separator !== ""
        ? source.separator
        : LIST_LAYOUT_DEFAULTS.separator,
  };
}

export function ListLayoutFields({
  options,
  set,
}: {
  options: ListLayoutOptions;
  set: (key: keyof ListLayoutOptions, value: unknown) => void;
}) {
  const labels: Record<ListMarker, () => string> = {
    bullet: m.query_view_list_marker_bullet,
    number: m.query_view_list_marker_number,
    none: m.query_view_list_marker_none,
  };
  const indentLabelId = useUniqueId();
  return (
    <>
      <Chooser.PageField label={m.query_view_list_markers()}>
        <Dropdown
          value={options.markers}
          data-query-view-option="markers"
          onChange={(value) =>
            set(
              "markers",
              value === LIST_LAYOUT_DEFAULTS.markers ? undefined : value,
            )
          }
        >
          {LIST_MARKERS.map((marker) => (
            <DropdownItem key={marker} value={marker}>
              {labels[marker]()}
            </DropdownItem>
          ))}
        </Dropdown>
      </Chooser.PageField>
      <Chooser.PageField
        label={m.query_view_list_indent_properties()}
        labelId={indentLabelId}
        inline
      >
        <span className="zt:flex" data-query-view-option="indentProperties">
          <Toggle
            value={options.indentProperties}
            aria-labelledby={indentLabelId}
            onChange={(value) => set("indentProperties", value)}
          />
        </span>
      </Chooser.PageField>
      {!options.indentProperties && (
        <Chooser.PageField label={m.query_view_list_property_separator()}>
          <input
            type="text"
            value={options.separator}
            placeholder={LIST_LAYOUT_DEFAULTS.separator}
            data-query-view-option="separator"
            onInput={(event) => {
              const value = event.currentTarget.value;
              set("separator", value === "" ? undefined : value);
            }}
          />
        </Chooser.PageField>
      )}
    </>
  );
}

const ESTIMATES = { heading: HEADING_ESTIMATE, row: 28 };

export function ListLayout({ view }: { view: QueryView }) {
  const { properties, groups } = useRecordGroups(view);
  const options = listLayoutOptions(useQueryViewState(view, (s) => s.view));
  const { markers, indentProperties, separator } = options;
  const entries = useMemo(() => groupEntries(groups), [groups]);

  const [box, setBox] = useState<HTMLElement | null>(null);
  const { heights, metrics, read } = useListRowHeights(box, entries, {
    properties,
    options,
  });

  const windowEntries = useMemo(
    () =>
      entries.map((entry, index): WindowEntry => {
        if (entry.kind === "heading")
          return { key: entry.key, kind: "heading", item: null };
        const height = heights?.[index] ?? null;
        return {
          key: entry.key,
          kind: "row",
          item: entry.record.row.indexedKey,
          ...(height !== null && { height }),
        };
      }),
    [entries, heights],
  );
  const draw = (index: number): DrawnEntry => {
    const entry = entries[index]!;
    if (entry.kind === "heading")
      return {
        props: {
          className: cn(
            "zt:list-none",
            markers !== "none" && "zt:-ml-(--list-indent)",
            index > 0 && "zt:pt-2",
          ),
        },
        children: <RecordGroupHeading group={entry.group} />,
      };
    return drawListRow(entry.record, entry.at, { properties, options });
  };
  return (
    <ItemsWindow
      view={view}
      entries={windowEntries}
      estimates={ESTIMATES}
      shape={JSON.stringify([
        [markers, indentProperties, separator],
        properties.map(({ path }) => path),
        metrics && [Math.round(metrics.width), metrics.font],
      ])}
      box={{
        className: "zt:px-3 zt:pt-2 zt:pb-11 zt:in-[.zt-query-note]:pb-2",
        "data-query-layout": "list",
      }}
      boxRef={setBox}
      flow={{
        kind: "list",
        as: markers === "number" ? "ol" : "ul",
        props: {
          className: cn(
            "zt:my-0 zt:py-1 zt:text-(length:--font-smaller) zt:wrap-break-word zt:marker:text-(--list-marker-color)",
            markers === "bullet" && "zt:list-disc zt:pl-(--list-indent)",
            markers === "number" && "zt:list-decimal zt:pl-(--list-indent)",
            markers === "none" && "zt:list-none zt:pl-0",
          ),
          "data-query-markers": markers,
        },
        ghost: LIST_GHOST,
      }}
      draw={draw}
      drew={read}
    />
  );
}
