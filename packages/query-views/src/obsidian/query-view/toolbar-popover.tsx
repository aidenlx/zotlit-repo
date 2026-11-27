import type { IconName } from "obsidian";
import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  ReactNode,
  Ref,
} from "react";
import { useRef, useState } from "react";

import { Icon } from "@zotlit/obsidian-kit/components/obsidian/icon.tsx";
import { PinnedPopover } from "@zotlit/obsidian-kit/components/pinned-popover.tsx";
import type { PinnedPopoverHandle } from "@zotlit/obsidian-kit/components/pinned-popover.tsx";
import { cn, tooltipAttrs } from "@zotlit/obsidian-kit/utils.ts";

import { ToolbarButton } from "./toolbar-button.tsx";

export const toolbarPopoverClass = cn(
  "zt:flex zt:max-h-[min(--spacing(120),calc(100vh_-_--spacing(2)))] zt:max-w-[min(--spacing(110),100vw)] zt:min-w-55 zt:flex-col zt:p-0",
  "zt:border-(length:--menu-border-width) zt:border-(--menu-border-color) zt:bg-(--menu-background) zt:text-foreground zt:shadow-(--menu-shadow) zt:[backdrop-filter:var(--menu-backdrop-filter)]",
  "zt:rounded-(--menu-radius) zt:[corner-shape:var(--menu-corner-shape)]",
);

export interface ToolbarPopoverProps {
  icon: IconName;
  label: string;
  active?: boolean;
  count?: number;
  hook: string;
  onOpen?: () => void;
  onClose?: () => void;
  off?: string;
  className?: string;
  children: ReactNode;
}

export function ToolbarPopover({
  icon,
  label,
  active,
  count,
  hook,
  onOpen,
  onClose,
  off,
  className,
  children,
}: ToolbarPopoverProps) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const popover = useRef<PinnedPopoverHandle>(null);
  return (
    <>
      <ToolbarButton
        ref={button}
        icon={icon}
        label={label}
        active={active}
        count={count}
        open={open}
        {...(off === undefined
          ? { onClick: () => popover.current?.toggle(), "aria-expanded": open }
          : { "aria-disabled": true, ...tooltipAttrs(off) })}
        data-query-toolbar={hook}
        className="zt:aria-disabled:cursor-default zt:aria-disabled:opacity-50 zt:aria-disabled:hover:bg-transparent zt:aria-disabled:hover:text-muted-foreground"
      />
      <PinnedPopover
        anchor={button}
        handle={popover}
        data-query-popover={hook}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) onOpen?.();
          else onClose?.();
        }}
        className={cn(toolbarPopoverClass, className)}
      >
        <div className="zt:flex zt:min-h-0 zt:flex-1 zt:flex-col zt:overflow-auto zt:rounded-[inherit] zt:[corner-shape:inherit]">
          {children}
        </div>
      </PinnedPopover>
    </>
  );
}

export function PopoverSection({
  className,
  ...rest
}: HTMLAttributes<HTMLElement>) {
  return (
    <section
      {...rest}
      className={cn(
        "zt:flex zt:flex-col zt:p-(--size-2-1) zt:not-last:border-b-(length:--border-width) zt:not-last:border-border",
        className,
      )}
    />
  );
}

export function PopoverHeader({
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-query-popover-header=""
      {...rest}
      className={cn(
        "zt:flex zt:items-center zt:gap-(--size-4-1) zt:px-(--size-4-3) zt:py-(--size-4-2) zt:text-sm zt:[font-weight:var(--font-medium)] zt:text-foreground",
        className,
      )}
    />
  );
}

const rowClass =
  "zt:flex zt:w-full zt:items-center zt:gap-(--size-4-2) zt:rounded-sm zt:[corner-shape:var(--corner-shape)] zt:p-(--size-2-2) zt:ps-(--size-2-3) zt:text-start zt:text-sm zt:text-foreground zt:hover:bg-muted";

export function PopoverActions({
  className,
  ...rest
}: HTMLAttributes<HTMLElement>) {
  return (
    <PopoverSection
      data-query-popover-actions=""
      {...rest}
      className={cn("zt:p-(--size-4-1)", className)}
    />
  );
}

export interface PopoverActionProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  ref?: Ref<HTMLButtonElement>;
  [data: `data-${string}`]: string | undefined;
}

export function PopoverAction({
  icon,
  className,
  children,
  ...rest
}: PopoverActionProps) {
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        "zt-query-popover-action zt:cursor-(--cursor)",
        rowClass,
        className,
      )}
    >
      <Icon
        name={icon}
        size="s"
        className="zt:shrink-0 zt:text-muted-foreground"
      />
      <span className="zt:truncate">{children}</span>
    </button>
  );
}
