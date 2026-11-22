import { cn } from "@/lib/cn.ts";

export const metaClass = "text-[0.9375rem] leading-[1.45]";

export const textLinkClass =
  "rounded-sm text-fd-primary underline decoration-fd-primary/40 underline-offset-4 hover:decoration-fd-primary";

export const secondaryButtonClass = cn(
  metaClass,
  "inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-[10px] border border-transparent bg-fd-background px-5 py-2.5 font-semibold text-fd-foreground shadow-ring transition-[box-shadow,scale] duration-150 hover:shadow-ring-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-ring motion-safe:active:scale-[0.96]",
);
