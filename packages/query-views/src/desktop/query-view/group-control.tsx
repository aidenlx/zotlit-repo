import type {
  QueryFileGroupValue,
  QueryFileSort,
} from "#core/query-view/query-file.ts";

import {
  Dropdown,
  DropdownItem,
} from "@zotlit/obsidian-kit/components/obsidian/dropdown.tsx";
import { Select } from "@zotlit/obsidian-kit/components/select.tsx";
import { cn } from "@zotlit/obsidian-kit/utils.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import type { PropertyOption } from "./properties.ts";
import { directionLabel } from "./properties.ts";
import type { LayoutGroup } from "./rows.ts";
import {
  JoinedSelects,
  NotUsed,
  RemoveButton,
  propertySelectOption,
  sortRowClass,
  unlistedOption,
  sortRowsClass,
} from "./sort-control.tsx";

import { GripIcon, moved, useReorder } from "#obsidian/query-view/reorder.tsx";
import {
  PopoverAction,
  PopoverActions,
  PopoverHeader,
  PopoverSection,
} from "#obsidian/query-view/toolbar-popover.tsx";
import "./group-control.css";

export interface GroupSetting {
  groupBy?: QueryFileSort;
  groupOrder?: readonly QueryFileGroupValue[];
}

export interface GroupEditorProps {
  value: GroupSetting;
  options: readonly PropertyOption[];
  groups: readonly LayoutGroup[];
  unused?: boolean;
  labelOf?: (path: string) => string;
  onChange: (next: GroupSetting) => void;
}

const NONE = "";
const MANUAL = "MANUAL";

export function GroupEditor({
  value,
  options,
  groups,
  unused = false,
  labelOf,
  onChange,
}: GroupEditorProps) {
  const { groupBy, groupOrder } = value;
  const manual = groupOrder !== undefined;
  const option = options.find((entry) => entry.path === groupBy?.property);
  return (
    <>
      <PopoverSection data-group-editor="">
        <PopoverHeader>{m.query_view_group_by()}</PopoverHeader>
        <div className={cn(sortRowsClass, "zt:ps-(--size-2-3)")}>
          <div className={sortRowClass}>
            <JoinedSelects
              property={
                <Select
                  aria-label={m.query_view_group_by()}
                  data-group-property=""
                  className="zt:min-w-0 zt:flex-1"
                  placeholder={m.query_view_property_placeholder()}
                  value={groupBy?.property ?? NONE}
                  options={[
                    ...(!option && groupBy
                      ? [
                          propertySelectOption(
                            unlistedOption(groupBy.property, labelOf),
                          ),
                        ]
                      : []),
                    ...options.map(propertySelectOption),
                  ]}
                  onChange={(property) =>
                    onChange({
                      groupBy: {
                        property,
                        direction: groupBy?.direction ?? "ASC",
                      },
                    })
                  }
                />
              }
              direction={
                <Dropdown
                  aria-label={m.query_view_group()}
                  data-group-direction=""
                  className="zt:shrink-0"
                  disabled={!groupBy}
                  value={manual ? MANUAL : (groupBy?.direction ?? "ASC")}
                  onChange={(direction) => {
                    if (!groupBy) return;
                    onChange(
                      direction === MANUAL
                        ? {
                            groupBy,
                            groupOrder: groups.map((group) => group.value),
                          }
                        : {
                            groupBy: {
                              ...groupBy,
                              direction: direction === "DESC" ? "DESC" : "ASC",
                            },
                          },
                    );
                  }}
                >
                  {(["ASC", "DESC"] as const).map((direction) => (
                    <DropdownItem key={direction} value={direction}>
                      {directionLabel(option?.kind ?? "text", direction)}
                    </DropdownItem>
                  ))}
                  <DropdownItem value={MANUAL}>
                    {m.query_view_group_manual()}
                  </DropdownItem>
                </Dropdown>
              }
            />
            {unused && (
              <span data-group-unused="">
                <NotUsed />
              </span>
            )}
            <RemoveButton
              label={m.query_view_group_remove()}
              data-group-remove=""
              disabled={!groupBy}
              onClick={() => onChange({})}
            />
          </div>
        </div>
      </PopoverSection>
      {groupBy && groupOrder && (
        <ManualOrder
          groups={groups}
          order={groupOrder}
          onChange={(next) => onChange({ groupBy, groupOrder: next })}
        />
      )}
    </>
  );
}

function ManualOrder({
  groups,
  order,
  onChange,
}: {
  groups: readonly LayoutGroup[];
  order: readonly QueryFileGroupValue[];
  onChange: (next: QueryFileGroupValue[]) => void;
}) {
  const unlisted = order.filter(
    (value) => !groups.some((group) => group.value === value),
  );
  const save = (
    rows: readonly { value: QueryFileGroupValue; shown: boolean }[],
  ) =>
    onChange([
      ...rows.filter((row) => row.shown).map((row) => row.value),
      ...unlisted,
    ]);
  const reorder = useReorder(groups.length, (from, to) =>
    save(moved(groups, from, to)),
  );
  if (groups.length === 0)
    return (
      <PopoverSection data-group-order="">
        <div className="zt:px-(--size-4-3) zt:py-(--size-4-2) zt:text-sm zt:text-muted-foreground">
          {m.query_view_group_empty()}
        </div>
      </PopoverSection>
    );
  const anyShown = groups.some((group) => group.shown);
  return (
    <>
      <PopoverSection data-group-order="">
        {groups.map((group, index) => {
          const { row, handle } = reorder(index);
          return (
            <label
              key={group.value ?? ""}
              data-group-row={group.value ?? ""}
              {...row}
              className={cn(
                "zt:flex zt:items-center zt:gap-(--size-4-2) zt:rounded-sm zt:p-(--size-2-2) zt:ps-(--size-2-3) zt:text-sm zt:text-foreground zt:[corner-shape:var(--corner-shape)] zt:hover:bg-muted",
                row.className,
              )}
            >
              <span {...handle}>
                <GripIcon />
              </span>
              <input
                type="checkbox"
                className="zt:shrink-0"
                checked={group.shown}
                onChange={() =>
                  save(
                    groups.map((candidate) =>
                      candidate === group
                        ? { ...candidate, shown: !candidate.shown }
                        : candidate,
                    ),
                  )
                }
              />
              <span className="zt:min-w-0 zt:flex-1 zt:truncate">
                {group.label}
              </span>
              <span
                className="zt:pe-(--size-2-2) zt:text-xs zt:text-(--text-faint) zt:tabular-nums"
                data-group-count=""
              >
                {group.count}
              </span>
            </label>
          );
        })}
      </PopoverSection>
      <PopoverActions>
        <PopoverAction
          icon={anyShown ? "eye-off" : "eye"}
          data-group-toggle-all=""
          onClick={() =>
            save(groups.map((group) => ({ ...group, shown: !anyShown })))
          }
        >
          {anyShown
            ? m.query_view_group_hide_all()
            : m.query_view_group_show_all()}
        </PopoverAction>
      </PopoverActions>
    </>
  );
}
