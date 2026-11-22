import { useAtomSet, useAtomValue } from "@effect/atom-react";

import { useObsidianApp } from "@zotlit/obsidian-kit/app-context.ts";
import { Icon } from "@zotlit/obsidian-kit/components/obsidian/icon.tsx";
import { selectionControl } from "@zotlit/obsidian-kit/components/obsidian/selection-control.ts";
import { tooltipAttrs } from "@zotlit/obsidian-kit/utils.ts";
import { useUniqueId } from "@zotlit/ui";

import { useWorkbenchModel } from "./editor.tsx";
import { chooseWorkbenchOption } from "./suggester.ts";

const sampleSuggesterTrigger = selectionControl({ kind: "icon" });

export interface SampleOption {
  readonly value: string;
  readonly label: string;
  readonly description: string;
}

export function SampleSuggester({
  id,
  title,
  label,
  selected,
  groups,
  onSelect,
}: {
  readonly id?: string;
  readonly title: string;
  readonly label?: string;
  readonly selected: string;
  readonly groups: readonly {
    readonly heading: string;
    readonly options: readonly SampleOption[];
    readonly empty?: string;
  }[];
  readonly onSelect: (value: string) => void;
}) {
  const app = useObsidianApp();
  const command = useWorkbenchModel().choose(useUniqueId());
  const open = useAtomValue(command).waiting;
  const choose = useAtomSet(command);
  const labelTooltip = tooltipAttrs(label ?? "");
  const triggerTooltip = tooltipAttrs(title);
  const instanceId = useUniqueId();
  const trigger = (
    <button
      type="button"
      id={id ?? instanceId}
      data-part="trigger"
      className={sampleSuggesterTrigger}
      {...triggerTooltip}
      aria-label={title}
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={(event) => {
        choose({
          choose: chooseWorkbenchOption(app, {
            anchor: event.currentTarget,
            title,
            selected,
            groups: groups.map((group) => ({
              label: group.heading,
              empty: group.empty,
              options: group.options.map((option) => ({
                id: option.value,
                label: option.label,
                hint: option.description,
              })),
            })),
          }),
          chosen: onSelect,
        });
      }}
    >
      <Icon name="search" />
    </button>
  );
  if (label === undefined) return trigger;
  return (
    <div
      data-part="suggester"
      className="zt:flex zt:min-w-0 zt:flex-1 zt:items-center zt:gap-2"
    >
      <span
        data-part="label"
        className="zt:min-w-0 zt:flex-1 zt:truncate zt:text-xs zt:text-muted-foreground"
        {...labelTooltip}
      >
        {label}
      </span>
      {trigger}
    </div>
  );
}
