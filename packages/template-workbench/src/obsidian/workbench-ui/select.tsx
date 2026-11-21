// Native selection semantics: Obsidian's dropdown surface and a chevron glyph.
import type { ComponentProps } from "react";

import { Dropdown } from "@zotlit/obsidian-kit/components/obsidian/dropdown.tsx";
import type { DropdownProps } from "@zotlit/obsidian-kit/components/obsidian/dropdown.tsx";
import { Icon } from "@zotlit/obsidian-kit/components/obsidian/icon.tsx";
import { cn } from "@zotlit/obsidian-kit/utils.ts";

export function WorkbenchSelect({
  className,
  ...props
}: Omit<DropdownProps, "style" | "size" | "ref">) {
  return (
    <div data-part="wrapper" className="zt:min-w-0 zt:max-w-full">
      <Dropdown
        data-part="select"
        {...props}
        className={cn("zt:max-w-full", className)}
      />
      <span aria-hidden data-part="icon" className="zt:hidden">
        <Icon name="chevron-down" />
      </span>
    </div>
  );
}

export function WorkbenchOption(
  props: Omit<ComponentProps<"option">, "className" | "style">,
) {
  return <option data-part="option" {...props} />;
}
