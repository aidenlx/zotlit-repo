import type { Ref } from "react";
import { useMemo } from "react";

import type {
  ChooserActionRow,
  ChooserGroup,
  ChooserItemRow,
} from "@zotlit/obsidian-kit/components/chooser-logic.ts";
import { Chooser } from "@zotlit/obsidian-kit/components/chooser.tsx";
import {
  iconButton,
  IconButton,
} from "@zotlit/obsidian-kit/components/obsidian/icon-button.tsx";
import { Icon } from "@zotlit/obsidian-kit/components/obsidian/icon.tsx";
import { cn, tooltipAttrs } from "@zotlit/obsidian-kit/utils.ts";
import { annotationColorLabel } from "@zotlit/plugin-kernel/annotation-colors.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { runtime } from "@zotlit/plugin-messages/runtime.ts";

import type { TagChip } from "./filter.ts";
import {
  cappedSelection,
  deriveSwatchColors,
  deriveTagChips,
  filterAnnotations,
  isFilterActive,
} from "./filter.ts";
import {
  useAnnotFilter,
  useAnnotStore,
  useClearFilters,
  useSetSelectedColors,
  useSetSelectedTags,
  useToggleSearchOpen,
  useToggleSelectedColor,
} from "./model.ts";

const COLOR_CAP = 3;

const TAG_CAP = 1;

export interface FilterBarProps {
  searchBarId: string;
  searchButtonRef: Ref<HTMLDivElement>;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

export function FilterBar({
  searchBarId,
  searchButtonRef,
  collapsed,
  onToggleCollapsed,
}: FilterBarProps) {
  const annotations = useAnnotStore((s) => s.annotations);
  const selectedColors = useAnnotStore((s) => s.selectedColors);
  const searchOpen = useAnnotStore((s) => s.searchOpen);
  const clearFilters = useClearFilters();
  const toggleSearchOpen = useToggleSearchOpen();
  const toggleColor = useToggleSelectedColor();
  const setColors = useSetSelectedColors();
  const setTags = useSetSelectedTags();

  const filter = useAnnotFilter();

  const swatchColors = useMemo(
    () => (annotations ? deriveSwatchColors(annotations) : []),
    [annotations],
  );
  const tagChips = useMemo(
    () => (annotations ? deriveTagChips(annotations, filter) : []),
    [annotations, filter],
  );
  const shown = useMemo(
    () => (annotations ? filterAnnotations(annotations, filter).length : 0),
    [annotations, filter],
  );
  const total = annotations?.length ?? 0;
  const active = isFilterActive(filter);

  if (!annotations || annotations.length === 0) return null;

  return (
    <div className="zt:flex zt:shrink-0 zt:flex-wrap zt:items-center zt:gap-y-1 zt:px-2 zt:pt-1 zt:text-sm">
      <ColorChooser
        colors={swatchColors}
        selectedColors={selectedColors}
        onToggle={toggleColor}
        onClear={() => setColors([])}
      />
      <TagChooser
        chips={tagChips}
        selectedTags={filter.tags}
        onChange={setTags}
      />
      <IconButton
        ref={searchButtonRef}
        icon="search"
        active={searchOpen}
        aria-expanded={searchOpen}
        aria-controls={searchBarId}
        onClick={toggleSearchOpen}
        {...tooltipAttrs(m.annot_view_search_tooltip())}
      />
      <div className="zt:ms-auto zt:flex zt:shrink-0 zt:items-center zt:gap-1">
        {active && (
          <span className="zt:whitespace-nowrap zt:text-muted-foreground zt:tabular-nums">
            {m.annot_view_filter_count({ shown, total })}
          </span>
        )}
        {active && (
          <IconButton
            icon="filter-x"
            onClick={clearFilters}
            {...tooltipAttrs(m.annot_view_clear_filters())}
          />
        )}
        <IconButton
          icon={collapsed ? "chevrons-up-down" : "chevrons-down-up"}
          onClick={onToggleCollapsed}
          {...tooltipAttrs(
            collapsed
              ? m.annot_view_expand_tooltip()
              : m.annot_view_collapse_tooltip(),
          )}
        />
      </div>
    </div>
  );
}

const filterTrigger = iconButton({
  className:
    "zt:inline-flex zt:min-w-0 zt:items-center zt:gap-1 zt:rounded-(--clickable-icon-radius) zt:px-1.5 zt:py-1 zt:text-muted-foreground zt:hover:bg-muted zt:hover:text-foreground zt:focus-visible:ring-2 zt:focus-visible:ring-border-focus zt:focus-visible:outline-none zt:data-open:bg-muted zt:data-open:text-foreground zt:aria-disabled:bg-transparent zt:aria-disabled:text-muted-foreground",
});

function TriggerChevron() {
  return (
    <Icon
      name="chevron-down"
      size="xs"
      className="zt:duration-150 zt:group-data-open:rotate-180 zt:motion-safe:transition-transform"
    />
  );
}

function HiddenCount({ count }: { count: number }) {
  return (
    <span className="zt:tabular-nums">
      {m.annot_view_filter_more_count({ count })}
    </span>
  );
}

function Swatch({ hex, className }: { hex: string; className?: string }) {
  return (
    <span
      className={cn(
        "zt:inline-block zt:shrink-0 zt:rounded-full zt:bg-(--zt-swatch-color) zt:align-middle zt:ring-1 zt:ring-foreground/10 zt:ring-inset",
        className,
      )}
      style={{ "--zt-swatch-color": hex } as React.CSSProperties}
    />
  );
}

function changedColor(
  before: readonly string[],
  after: readonly string[],
): string | undefined {
  return (
    after.find((hex) => !before.includes(hex)) ??
    before.find((hex) => !after.includes(hex))
  );
}

type ColorRow = ChooserItemRow | ChooserActionRow;

function ColorChooser({
  colors,
  selectedColors,
  onToggle,
  onClear,
}: {
  colors: readonly string[];
  selectedColors: readonly string[];
  onToggle: (color: string) => void;
  onClear: () => void;
}) {
  const counting = selectedColors.length > 0;

  const selected = useMemo(
    () => colors.filter((hex) => selectedColors.includes(hex)),
    [colors, selectedColors],
  );
  const { shown, hiddenCount } = cappedSelection(selected, COLOR_CAP);
  const blocked = colors.length === 0 && selectedColors.length === 0;

  const ariaLabel = counting
    ? m.annot_view_filter_color_trigger_active({
        colors: new Intl.ListFormat(runtime.getLocale(), {
          type: "conjunction",
        }).format(selected.map(annotationColorLabel)),
      })
    : m.annot_view_filter_color_trigger();

  const groups = useMemo<ChooserGroup<ColorRow>[]>(() => {
    const entries = colors.map((hex) => ({
      value: hex,
      label: annotationColorLabel(hex),
    }));
    if (selectedColors.length === 0) return [{ items: entries }];
    return [
      { items: entries },
      {
        items: [
          {
            id: "clear",
            label: m.annot_view_filter_color_clear(),
            action: () => onClear(),
          },
        ],
      },
    ];
  }, [colors, selectedColors.length, onClear]);

  return (
    <Chooser
      value={selectedColors}
      onValueChange={(next) => {
        const moved = changedColor(selectedColors, next);
        if (moved !== undefined) onToggle(moved);
      }}
    >
      <Chooser.Trigger
        className={filterTrigger}
        blocked={blocked}
        {...tooltipAttrs(
          blocked ? m.annot_view_filter_color_trigger_none() : ariaLabel,
        )}
      >
        {counting ? (
          <span className="zt:flex zt:items-center zt:gap-0.5">
            {shown.map((hex) => (
              <Swatch key={hex} hex={hex} className="zt:size-2.5" />
            ))}
          </span>
        ) : (
          <Icon name="palette" />
        )}
        {hiddenCount > 0 && <HiddenCount count={hiddenCount} />}
        <TriggerChevron />
      </Chooser.Trigger>
      <Chooser.Popup className="zt:min-w-40">
        <Chooser.List groups={groups} label={m.annot_view_filter_color_list()}>
          {(row) =>
            row.action ? (
              <Chooser.Action key={row.id} id={row.id} icon="x">
                {row.label}
              </Chooser.Action>
            ) : (
              <Chooser.Item key={row.value} value={row.value}>
                <Swatch hex={row.value} className="zt:me-1.5 zt:size-3" />
                {row.label}
              </Chooser.Item>
            )
          }
        </Chooser.List>
      </Chooser.Popup>
    </Chooser>
  );
}

interface TagEntryRow extends ChooserItemRow {
  hitCount: number;
}

type TagRow = TagEntryRow | ChooserActionRow;

function TagChooser({
  chips,
  selectedTags,
  onChange,
}: {
  chips: readonly TagChip[];
  selectedTags: readonly string[];
  onChange: (tags: string[]) => void;
}) {
  const counting = selectedTags.length > 0;

  const selected = useMemo(
    () => chips.filter((chip) => chip.selected).map((chip) => chip.name),
    [chips],
  );
  const { shown, hiddenCount } = cappedSelection(selected, TAG_CAP);
  const blocked = chips.length === 0 && selectedTags.length === 0;

  const ariaLabel = counting
    ? m.annot_view_filter_tag_trigger_active({
        tags: new Intl.ListFormat(runtime.getLocale(), {
          type: "conjunction",
        }).format(selected),
      })
    : m.annot_view_filter_tag_trigger();

  const groups = useMemo<ChooserGroup<TagRow>[]>(() => {
    const tags = chips.map((chip) => ({
      value: chip.name,
      label: chip.name,
      hitCount: chip.hitCount,
      disabled: !chip.selected && !chip.available,
    }));
    if (selectedTags.length === 0) return [{ items: tags }];
    return [
      { items: tags },
      {
        items: [
          {
            id: "clear",
            label: m.annot_view_filter_tag_clear(),
            action: () => onChange([]),
          },
        ],
      },
    ];
  }, [chips, selectedTags.length, onChange]);

  return (
    <Chooser value={selectedTags} onValueChange={onChange}>
      <Chooser.Trigger
        className={filterTrigger}
        blocked={blocked}
        {...tooltipAttrs(
          blocked ? m.annot_view_filter_tag_trigger_none() : ariaLabel,
        )}
      >
        <Icon name="tag" />
        {shown.map((name) => (
          <span key={name} className="zt:max-w-32 zt:min-w-0 zt:truncate">
            {name}
          </span>
        ))}
        {hiddenCount > 0 && <HiddenCount count={hiddenCount} />}
        <TriggerChevron />
      </Chooser.Trigger>
      <Chooser.Popup>
        <Chooser.Input
          placeholder={m.annot_view_filter_tag_search_placeholder()}
          clearLabel={m.annot_view_clear_search()}
        />
        <Chooser.List
          groups={groups}
          label={m.annot_view_filter_tag_list()}
          emptyLabel={m.annot_view_filter_tag_empty()}
        >
          {(row) =>
            row.action ? (
              <Chooser.Action key={row.id} id={row.id} icon="x">
                {row.label}
              </Chooser.Action>
            ) : (
              <Chooser.Item
                key={row.value}
                value={row.value}
                {...tooltipAttrs(
                  m.annot_view_filter_tag_tooltip({
                    name: row.label,
                    count: row.hitCount,
                  }),
                )}
              >
                {row.label}
              </Chooser.Item>
            )
          }
        </Chooser.List>
      </Chooser.Popup>
    </Chooser>
  );
}
