import type { IconName } from "obsidian";
import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";

import { Icon } from "@zotlit/obsidian-kit/components/obsidian/icon.tsx";
import { cn, tooltipAttrs } from "@zotlit/obsidian-kit/utils.ts";
import { themeHook } from "@zotlit/plugin-kernel/theme-hooks.ts";

import "./toolbar-button.css";

export const toolbarButtonLook = cn(
  "zt:inline-flex zt:min-w-0 zt:shrink-0 zt:items-center zt:gap-(--size-2-2) zt:overflow-hidden zt:p-(--size-2-2) zt:whitespace-nowrap",
  "zt:cursor-(--cursor) zt:rounded-(--button-radius) zt:text-sm zt:[font-weight:var(--input-font-weight)] zt:text-muted-foreground zt:[corner-shape:var(--button-corner-shape)]",
  "zt:hover:bg-muted zt:not-data-active:hover:text-foreground zt:data-open:bg-muted zt:not-data-active:data-open:text-foreground",
  "zt:data-active:text-(--icon-color-active) zt:data-active:hover:bg-accent zt:data-active:data-open:bg-accent",
  "zt:focus-visible:shadow-[0_0_0_var(--input-border-width-focus)_var(--background-modifier-border-focus)] zt:focus-visible:outline-none",
);

export const toolbarButtonClass = cn(
  themeHook.queryToolbarButton,
  toolbarButtonLook,
);

const labelClass = (keep?: boolean) =>
  cn("zt:truncate zt:pe-(--size-2-1)", !keep && "zt:hidden zt:@xl:block");

export interface ToolbarButtonContentProps {
  icon?: IconName;
  label: ReactNode;
  keepLabel?: boolean;
  labelClassName?: string;
  chevron?: boolean;
  count?: number;
}

export function ToolbarButtonContent({
  icon,
  label,
  keepLabel,
  labelClassName,
  chevron,
  count,
}: ToolbarButtonContentProps) {
  return (
    <>
      {icon && (
        <Icon
          name={icon}
          size="s"
          className={cn("zt:shrink-0", keepLabel && "zt:@max-2xs:hidden")}
        />
      )}
      <span className={cn(labelClass(keepLabel), labelClassName)}>{label}</span>
      {count !== undefined && count > 0 && (
        <span
          data-query-badge={count}
          className="zt:hidden zt:pe-(--size-2-1) zt:text-xs zt:opacity-60 zt:@xl:inline"
        >
          {count}
        </span>
      )}
      {chevron && (
        <Icon
          name="chevrons-up-down"
          size="xs"
          className="zt:ms-auto zt:shrink-0 zt:text-muted-foreground"
        />
      )}
    </>
  );
}

export interface ToolbarButtonProps
  extends
    Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">,
    ToolbarButtonContentProps {
  active?: boolean;
  open?: boolean;
  ref?: Ref<HTMLButtonElement>;
  [data: `data-${string}`]: string | undefined;
}

export function ToolbarButton({
  icon,
  label,
  keepLabel,
  labelClassName,
  chevron,
  count,
  active,
  open,
  className,
  ...rest
}: ToolbarButtonProps) {
  return (
    <button
      type="button"
      {...(typeof label === "string" ? tooltipAttrs(label) : {})}
      data-active={active ? "" : undefined}
      data-open={open ? "" : undefined}
      {...rest}
      className={cn(toolbarButtonClass, className)}
    >
      <ToolbarButtonContent
        icon={icon}
        label={label}
        keepLabel={keepLabel}
        labelClassName={labelClassName}
        chevron={chevron}
        count={count}
      />
    </button>
  );
}
