import type { HTMLAttributes, Ref } from "react";

import { cn } from "#utils.ts";

export interface SidebarToolbarProps extends HTMLAttributes<HTMLDivElement> {
  ref?: Ref<HTMLDivElement>;
}

export function SidebarToolbar({
  className,
  ref,
  ...rest
}: SidebarToolbarProps) {
  return (
    <div ref={ref} {...rest} className={cn("zt:flex zt:p-2", className)} />
  );
}

function Actions({ className, ref, ...rest }: SidebarToolbarProps) {
  return (
    <div
      ref={ref}
      {...rest}
      className={cn(
        "zt:flex zt:flex-wrap zt:justify-center zt:gap-0.5",
        className,
      )}
    />
  );
}

SidebarToolbar.Actions = Actions;
