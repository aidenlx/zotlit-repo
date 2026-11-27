import type { IconName } from "obsidian";
import type { HTMLAttributes, ReactNode, Ref } from "react";
import type { VariantProps } from "tailwind-variants";

import { tv } from "@zotlit/plugin-kernel/tw.ts";

import type { IconSize } from "./icon.tsx";
import { Icon } from "./icon.tsx";

export const iconButton = tv({
  base: "clickable-icon",
  variants: {
    active: { true: "is-active" },
    warning: { true: "mod-warning" },
    blocked: { true: "is-disabled" },
  },
});

type IconButtonVariants = VariantProps<typeof iconButton>;

export interface IconButtonProps
  extends
    Omit<HTMLAttributes<HTMLDivElement>, "role" | "tabIndex" | "children">,
    IconButtonVariants {
  icon: IconName;
  size?: IconSize;
  disabled?: boolean;
  pressed?: boolean;
  blocked?: boolean;
  children?: ReactNode;
  ref?: Ref<HTMLDivElement>;
}

export function IconButton({
  icon,
  size,
  active,
  warning,
  disabled,
  pressed,
  blocked,
  className,
  onClick,
  onKeyDown,
  children,
  ref,
  ...rest
}: IconButtonProps) {
  const inert = disabled || blocked;
  return (
    <div
      ref={ref}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={inert || undefined}
      aria-pressed={pressed}
      {...rest}
      className={iconButton({
        active: active ?? pressed,
        warning,
        blocked,
        className,
      })}
      onClick={(e) => {
        if (inert) return;
        onClick?.(e);
      }}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        if (e.defaultPrevented || inert) return;
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.click();
        }
      }}
    >
      <Icon name={icon} size={size} />
      {children}
    </div>
  );
}

export function IconButtonSpace({
  icon,
  size,
  className,
}: {
  icon: IconName;
  size?: IconSize;
  className?: string;
}) {
  return (
    <span className={iconButton({ className: ["zt:invisible", className] })}>
      <Icon name={icon} size={size} />
    </span>
  );
}
