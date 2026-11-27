import type {
  ButtonHTMLAttributes,
  FocusEvent,
  KeyboardEvent,
  PointerEvent,
  ReactNode,
  Ref,
  RefObject,
} from "react";
import { useCallback, useRef } from "react";

import * as m from "@zotlit/plugin-messages/messages.ts";
import { composing } from "@zotlit/ui";

import type { ChooserItemRow } from "./chooser-logic.ts";
import { Chooser, useChooserOpenSearch } from "./chooser.tsx";
import type { PinnedPopoverHandle } from "./pinned-popover.tsx";

import { Icon } from "#components/obsidian/icon.tsx";
import { cn } from "#utils.ts";

export interface SelectOption {
  value: string;
  label: string;
  icon?: ReactNode;
  detail?: string;
  searchTerms?: readonly string[];
  disabled?: boolean;
}

export interface SelectProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "value" | "onChange" | "children" | "type"
> {
  value: string;
  onChange: (next: string) => void;
  options: readonly SelectOption[];
  placeholder?: string;
  ref?: Ref<HTMLButtonElement>;
}

interface SelectRow extends ChooserItemRow {
  option: SelectOption;
}

const triggerClass = cn(
  "zt:flex zt:h-(--input-height) zt:max-w-full zt:min-w-0 zt:items-center zt:gap-(--size-2-2) zt:overflow-hidden zt:whitespace-nowrap",
  "zt:ps-(--size-4-2) zt:pe-(--size-2-3) zt:text-start zt:text-sm zt:leading-(--line-height-tight) zt:font-(--input-font-weight) zt:text-foreground",
  "zt:cursor-(--cursor) zt:rounded-(--input-radius) zt:bg-(--dropdown-background) zt:shadow-(--input-shadow) zt:[corner-shape:var(--corner-shape)]",
  "zt:not-aria-disabled:hover:bg-(--dropdown-background-hover) zt:not-aria-disabled:hover:shadow-(--input-shadow-hover) zt:data-open:bg-(--dropdown-background-hover)",
  "zt:focus-visible:shadow-[0_0_0_var(--input-border-width-focus)_var(--background-modifier-border-focus)] zt:focus-visible:outline-none",
);

const glyphClass =
  "zt:flex zt:min-w-(--icon-s) zt:shrink-0 zt:items-center zt:text-(--icon-color) zt:[--icon-size:var(--icon-s)] zt:[--icon-stroke:var(--icon-s-stroke-width)]";

export function Select({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  className,
  onKeyDown,
  ref,
  ...rest
}: SelectProps) {
  const popup = useRef<PinnedPopoverHandle>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const attach = useCallback(
    (node: HTMLButtonElement | null) => {
      trigger.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  const choose = useCallback(
    (next: string[]) => {
      const picked = next.find((entry) => entry !== value);
      popup.current?.hide();
      if (picked !== undefined) onChange(picked);
    },
    [value, onChange],
  );

  return (
    <Chooser value={[value]} onValueChange={choose}>
      <SelectBody
        {...rest}
        value={value}
        options={options}
        placeholder={placeholder}
        disabled={disabled}
        className={className}
        onKeyDown={onKeyDown}
        attach={attach}
        popup={popup}
        trigger={trigger}
      />
    </Chooser>
  );
}

interface SelectBodyProps extends Omit<SelectProps, "onChange" | "ref"> {
  attach: (node: HTMLButtonElement | null) => void;
  popup: RefObject<PinnedPopoverHandle | null>;
  trigger: RefObject<HTMLButtonElement | null>;
}

function SelectBody({
  value,
  options,
  placeholder,
  disabled,
  className,
  onKeyDown,
  attach,
  popup,
  trigger,
  ...rest
}: SelectBodyProps) {
  const openSearch = useChooserOpenSearch();
  const current = options.find((option) => option.value === value);
  const glyphs = options.some((option) => option.icon !== undefined);
  const rows: SelectRow[] = options.map((option) => ({
    value: option.value,
    label: shownDetail(option)
      ? `${option.label} ${option.detail}`
      : option.label,
    searchTerms: option.searchTerms,
    disabled: option.disabled,
    option,
  }));

  const pressed = useRef(false);
  const leave = (event: FocusEvent<HTMLElement>) => {
    const next = event.relatedTarget;
    if (!next?.instanceOf(Node) || popup.current?.contains(next)) return;
    if (trigger.current?.contains(next) && pressed.current) return;
    if (trigger.current?.getAttribute("aria-expanded") !== "true") return;
    popup.current?.hide();
  };

  return (
    <>
      <Chooser.Trigger
        ref={attach}
        role="combobox"
        aria-haspopup="listbox"
        blocked={disabled}
        data-value={value}
        {...rest}
        onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
          onKeyDown?.(event);
          if (event.defaultPrevented || disabled) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            popup.current?.show();
            return;
          }
          if (
            event.key.length !== 1 ||
            event.key === " " ||
            event.ctrlKey ||
            event.metaKey ||
            event.altKey ||
            composing(event)
          )
            return;
          event.preventDefault();
          openSearch(event.key);
        }}
        onPointerDown={(event: PointerEvent<HTMLButtonElement>) => {
          rest.onPointerDown?.(event);
          pressed.current = true;
          event.currentTarget.doc.addEventListener(
            "pointerup",
            () => (pressed.current = false),
            { once: true, capture: true },
          );
        }}
        onBlur={(event: FocusEvent<HTMLButtonElement>) => {
          rest.onBlur?.(event);
          leave(event);
        }}
        className={cn(triggerClass, className)}
      >
        {current?.icon !== undefined && (
          <span aria-hidden className={glyphClass} data-select-icon="">
            {current.icon}
          </span>
        )}
        <span
          data-placeholder={!current && !value ? "" : undefined}
          className="zt:me-auto zt:min-w-0 zt:truncate zt:data-placeholder:text-(--input-placeholder-color)"
        >
          {current ? current.label : value || placeholder}
        </span>
        <Icon
          name="chevrons-up-down"
          size="xs"
          className="zt:shrink-0 zt:text-(--icon-color)"
        />
      </Chooser.Trigger>
      <Chooser.Popup handle={popup} data-select-popup="" onBlur={leave}>
        <Chooser.Input
          placeholder={m.select_search()}
          clearLabel={m.select_clear_search()}
        />
        <Chooser.List<SelectRow>
          groups={[{ items: rows }]}
          label={rest["aria-label"] ?? placeholder ?? ""}
          aria-multiselectable={false}
          emptyLabel={m.select_no_match()}
        >
          {(row) => (
            <Chooser.Item
              key={row.value}
              value={row.value}
              data-value={row.value}
              className="zt:group"
              leading={
                glyphs ? (
                  <span aria-hidden className={glyphClass}>
                    {row.option.icon}
                  </span>
                ) : (
                  false
                )
              }
              end={
                <>
                  {shownDetail(row.option) && (
                    <span className="zt:shrink-0 zt:truncate zt:text-xs zt:text-muted-foreground">
                      {row.option.detail}
                    </span>
                  )}
                  <Icon
                    name="check"
                    size="xs"
                    className="zt:invisible zt:shrink-0 zt:group-aria-selected:visible"
                  />
                </>
              }
            >
              <span data-select-label="">{row.option.label}</span>
            </Chooser.Item>
          )}
        </Chooser.List>
      </Chooser.Popup>
    </>
  );
}

function shownDetail(option: SelectOption): boolean {
  return !!option.detail && option.detail !== option.label;
}
