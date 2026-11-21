import { useRef } from "react";

import { iconButton } from "@zotlit/obsidian-kit/components/obsidian/icon-button.tsx";
import { Icon } from "@zotlit/obsidian-kit/components/obsidian/icon.tsx";
import { tooltipAttrs } from "@zotlit/obsidian-kit/utils.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { TagsInput, useTagsInput } from "@zotlit/ui";

import { useContainerName } from "./host.tsx";
import { useInputSuggestions } from "./match.input.tsx";

// Wrapping list values retain free text and optional host suggestions.

const matchChips =
  "zt:flex zt:min-h-(--input-height) zt:min-w-0 zt:flex-wrap zt:items-start zt:gap-x-1.5 zt:px-2 zt:[--metadata-divider-width:0px] zt:[--metadata-input-font-size:var(--font-ui-small)] zt:[--metadata-input-text-color:var(--text-normal)]";
const matchChipInput =
  "zt:[field-sizing:content] zt:w-auto zt:max-w-full zt:min-w-[2ch] zt:flex-none zt:[--background-modifier-form-field:transparent] zt:[--input-padding:0px]";
export interface ChipInputProps {
  values: readonly string[];
  onChange: (values: string[]) => void;
  placeholder: string;
  suggestions?: readonly string[];
  hint?: (value: string) => string | null;
}

/** A Match value commits on a comma as well as on Enter. */
const COMMIT_KEYS = ["Enter", ","];

export function ChipInput({
  values,
  onChange,
  placeholder,
  suggestions,
  hint,
}: ChipInputProps) {
  return (
    <TagsInput.Root
      data-part="chips"
      className={matchChips}
      data-chip-input=""
      value={values}
      onValueChange={onChange}
      commitKeys={COMMIT_KEYS}
    >
      {values.map((value, index) => (
        <TagsInput.Item
          key={index}
          value={value}
          index={index}
          data-part="chip-item"
          className="zt:flex zt:min-w-0 zt:max-w-full zt:flex-col"
        >
          <div
            data-part="chip-line"
            className="metadata-property-value zt:min-w-0"
          >
            <span data-part="chip" className="multi-select-pill">
              <TagsInput.ItemText
                data-part="chip-value"
                className="multi-select-pill-content"
              />
              <TagsInput.ItemRemove
                data-part="chip-remove"
                className={iconButton({
                  className: "multi-select-pill-remove-button",
                })}
                {...tooltipAttrs(m.workbench_match_chip_remove({ value }))}
              >
                <Icon name="x" />
              </TagsInput.ItemRemove>
            </span>
          </div>
          {hint?.(value) && (
            <span
              data-part="hint"
              className="zt:pb-1 zt:text-xs zt:leading-normal zt:text-pretty zt:text-muted-foreground"
            >
              {hint(value)}
            </span>
          )}
        </TagsInput.Item>
      ))}
      <ChipField
        placeholder={placeholder}
        suggestions={suggestions}
        hint={hint}
      />
    </TagsInput.Root>
  );
}

/** The text field, offering the suggestions not yet among the values. */
function ChipField({
  placeholder,
  suggestions,
  hint,
}: Pick<ChipInputProps, "placeholder" | "suggestions" | "hint">) {
  const { value: values, add } = useTagsInput();
  const inputRef = useRef<HTMLInputElement>(null);
  const { list, datalist } = useInputSuggestions(inputRef, {
    suggestions: suggestions?.filter((value) => !values.includes(value)),
    hint,
    onSelect: add,
  });
  // A hidden name: a tooltip would hang over the gap after the chips.
  const name = useContainerName(m.workbench_match_value());
  return (
    <>
      <TagsInput.Input
        inputRef={inputRef}
        data-part="chip-input"
        className={matchChipInput}
        {...name.attrs}
        placeholder={values.length === 0 ? placeholder : ""}
        autoComplete="off"
        list={list}
      />
      {name.hiddenName}
      {datalist}
    </>
  );
}
