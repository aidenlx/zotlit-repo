import { Header } from "fumadocs-ui/layouts/docs/slots/header";
import type { ComponentProps } from "react";

import { cn } from "@/lib/cn.ts";

export function DocsSubnav(props: ComponentProps<"header">) {
  return (
    <Header
      {...props}
      className={cn(
        "after:absolute after:inset-x-0 after:-bottom-1 after:border-b-[3px] after:border-fd-border after:content-['']",
        props.className,
      )}
    />
  );
}
