// Native selection semantics: Obsidian's dropdown surface and a chevron glyph.
import type { ComponentProps } from "react";

import { Icon } from "@zotlit/obsidian-kit/components/obsidian/icon.tsx";

const SELECT = "dropdown zt:max-w-full";

export function WorkbenchSelect({
  className,
  ...props
}: Omit<ComponentProps<"select">, "style" | "size">) {
  return (
    <div data-part="wrapper" className="zt:min-w-0 zt:max-w-full">
      <select
        data-part="select"
        {...props}
        className={className ? `${SELECT} ${className}` : SELECT}
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
