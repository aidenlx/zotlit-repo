import type {
  QueryFileDirection,
  QueryFileSort,
} from "#core/query-view/query-file.ts";
import type { ReactNode } from "react";
import { useState } from "react";

import {
  Dropdown,
  DropdownItem,
} from "@zotlit/obsidian-kit/components/obsidian/dropdown.tsx";
import { iconButton } from "@zotlit/obsidian-kit/components/obsidian/icon-button.tsx";
import { Icon } from "@zotlit/obsidian-kit/components/obsidian/icon.tsx";
import { Select } from "@zotlit/obsidian-kit/components/select.tsx";
import type { SelectOption } from "@zotlit/obsidian-kit/components/select.tsx";
import { cn } from "@zotlit/obsidian-kit/utils.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import type { PropertyOption } from "./properties.ts";
import { directionLabel } from "./properties.ts";

import { GripIcon, moved, useReorder } from "#obsidian/query-view/reorder.tsx";
import {
  PopoverAction,
  PopoverActions,
  PopoverHeader,
  PopoverSection,
} from "#obsidian/query-view/toolbar-popover.tsx";

export interface SortEditorProps {
  value: readonly QueryFileSort[];
  options: readonly PropertyOption[];
  unused?: readonly string[];
  labelOf?: (path: string) => string;
  onChange: (next: QueryFileSort[]) => void;
}

export function unlistedOption(
  path: string,
  labelOf: (path: string) => string = (named) => named,
): PropertyOption {
  return { path, label: labelOf(path), kind: "text", icon: "file-question" };
}

function optionOf(
  options: readonly PropertyOption[],
  path: string,
  labelOf?: (path: string) => string,
): PropertyOption {
  return (
    options.find((option) => option.path === path) ??
    unlistedOption(path, labelOf)
  );
}

export function propertySelectOption(option: PropertyOption): SelectOption {
  return {
    value: option.path,
    label: option.label,
    icon: <Icon name={option.icon} />,
    detail: option.path,
    searchTerms: option.searchTerms,
  };
}

export const sortRowsClass =
  "zt:flex zt:flex-col zt:gap-(--size-2-3) zt:px-(--size-4-1) zt:pt-(--size-4-1) zt:pb-(--size-4-2)";

export const sortRowClass = "zt:flex zt:items-center zt:gap-(--size-4-1)";

export function JoinedSelects({
  property,
  direction,
}: {
  property: ReactNode;
  direction: ReactNode;
}) {
  return (
    <div
      data-joined-selects=""
      className={cn(
        "zt:flex zt:min-w-0 zt:flex-1 zt:items-stretch zt:overflow-hidden",
        "zt:rounded-(--metadata-property-radius) zt:[corner-shape:var(--metadata-property-corner-shape)]",
        "zt:shadow-(--metadata-property-box-shadow-hover) zt:focus-within:shadow-(--metadata-property-box-shadow-focus)",
        "zt:[--dropdown-background:var(--background-modifier-form-field)] zt:[--input-radius:0] zt:[--input-shadow-hover:none] zt:[--input-shadow:none]",
      )}
    >
      {property}
      <span
        aria-hidden="true"
        className="zt:w-(--border-width) zt:shrink-0 zt:bg-border"
      />
      {direction}
    </div>
  );
}

export function RemoveButton({
  label,
  disabled,
  onClick,
  ...data
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  [data: `data-${string}`]: string | undefined;
}) {
  return (
    <button
      type="button"
      className={iconButton({ className: "zt:shrink-0" })}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      {...data}
    >
      <Icon name="trash-2" size="s" />
    </button>
  );
}

export function NotUsed() {
  return (
    <span className="zt:shrink-0 zt:text-xs zt:text-(--text-faint)">
      {m.query_view_not_used()}
    </span>
  );
}

function EmptySortRow({
  options,
  onChange,
}: {
  options: readonly PropertyOption[];
  onChange: (sort: QueryFileSort) => void;
}) {
  const [direction, setDirection] = useState<QueryFileDirection>("ASC");
  return (
    <div className={sortRowsClass}>
      <div data-sort-empty="" className={sortRowClass}>
        <span aria-hidden="true" className="zt:opacity-50">
          <GripIcon />
        </span>
        <JoinedSelects
          property={
            <Select
              aria-label={m.query_view_sort_by()}
              data-sort-property=""
              className="zt:min-w-0 zt:flex-1"
              placeholder={m.query_view_property_placeholder()}
              value=""
              options={options.map(propertySelectOption)}
              onChange={(property) => onChange({ property, direction })}
            />
          }
          direction={
            <Dropdown
              aria-label={m.query_view_sort_by()}
              data-sort-direction=""
              className="zt:shrink-0"
              value={direction}
              onChange={(next) => setDirection(next as QueryFileDirection)}
            >
              {(["ASC", "DESC"] as const).map((entry) => (
                <DropdownItem key={entry} value={entry}>
                  {directionLabel("text", entry)}
                </DropdownItem>
              ))}
            </Dropdown>
          }
        />
        <RemoveButton
          label={m.query_view_sort_remove()}
          disabled
          onClick={() => {}}
        />
      </div>
    </div>
  );
}

export function SortEditor({
  value,
  options,
  unused: notUsed = [],
  labelOf,
  onChange,
}: SortEditorProps) {
  const reorder = useReorder(value.length, (from, to) =>
    onChange(moved(value, from, to)),
  );
  const unused = options.filter(
    (option) => !value.some((sort) => sort.property === option.path),
  );
  const set = (index: number, sort: QueryFileSort) =>
    onChange(value.map((entry, at) => (at === index ? sort : entry)));
  return (
    <>
      <PopoverSection data-sort-editor="">
        <PopoverHeader>{m.query_view_sort_by()}</PopoverHeader>
        {value.length === 0 && (
          <EmptySortRow
            options={options}
            onChange={(sort) => onChange([sort])}
          />
        )}
        {value.length > 0 && (
          <div className={sortRowsClass}>
            {value.map((sort, index) => {
              const option = optionOf(options, sort.property, labelOf);
              const { row, handle } = reorder(index);
              return (
                <div
                  key={sort.property}
                  data-sort-row={sort.property}
                  data-sort-unused={
                    notUsed.includes(sort.property) ? "" : undefined
                  }
                  {...row}
                  className={cn(sortRowClass, row.className)}
                >
                  <span {...handle}>
                    <GripIcon />
                  </span>
                  <JoinedSelects
                    property={
                      <Select
                        aria-label={m.query_view_sort_by()}
                        data-sort-property=""
                        className="zt:min-w-0 zt:flex-1"
                        value={sort.property}
                        options={[option, ...unused].map(propertySelectOption)}
                        onChange={(property) =>
                          set(index, { ...sort, property })
                        }
                      />
                    }
                    direction={
                      <Dropdown
                        aria-label={option.label}
                        data-sort-direction=""
                        className="zt:shrink-0"
                        value={sort.direction}
                        onChange={(direction) =>
                          set(index, {
                            ...sort,
                            direction: direction as QueryFileDirection,
                          })
                        }
                      >
                        {(["ASC", "DESC"] as const).map((direction) => (
                          <DropdownItem key={direction} value={direction}>
                            {directionLabel(option.kind, direction)}
                          </DropdownItem>
                        ))}
                      </Dropdown>
                    }
                  />
                  {notUsed.includes(sort.property) && <NotUsed />}
                  <RemoveButton
                    label={m.query_view_sort_remove()}
                    data-sort-remove=""
                    onClick={() =>
                      onChange(value.filter((_, at) => at !== index))
                    }
                  />
                </div>
              );
            })}
          </div>
        )}
      </PopoverSection>
      {unused.length > 0 && (
        <PopoverActions>
          <PopoverAction
            icon="plus"
            data-sort-add=""
            onClick={() =>
              onChange([
                ...value,
                { property: unused[0]!.path, direction: "ASC" },
              ])
            }
          >
            {m.query_view_sort_add()}
          </PopoverAction>
        </PopoverActions>
      )}
    </>
  );
}
