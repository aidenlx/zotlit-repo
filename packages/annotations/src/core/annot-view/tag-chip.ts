import { tv } from "@zotlit/plugin-kernel/tw.ts";

export const tagChipVariants = tv({
  base: "zt:rounded-(--tag-radius) zt:border-(length:--tag-border-width) zt:font-(--tag-weight) zt:focus-visible:ring-2 zt:focus-visible:ring-border-focus zt:motion-safe:transition-colors",
  variants: {
    state: {
      resting:
        "zt:cursor-pointer zt:border-(--tag-border-color) zt:bg-(--tag-background) zt:text-(color:--tag-color) zt:hover:border-(--tag-border-color-hover) zt:hover:bg-(--tag-background-hover) zt:hover:text-(color:--tag-color-hover)",
      selected:
        "zt:cursor-pointer zt:border-primary zt:bg-primary zt:text-primary-foreground",
      disabled:
        "zt:cursor-default zt:border-(--tag-border-color) zt:bg-(--tag-background) zt:text-(color:--tag-color) zt:opacity-40",
    },
    density: {
      comfortable: "zt:px-(--tag-padding-x) zt:py-(--tag-padding-y) zt:text-xs",
      dense: "zt:px-2 zt:py-px zt:text-xs",
    },
    truncate: {
      true: "zt:min-w-0 zt:shrink",
      false: "zt:shrink-0",
    },
  },
  defaultVariants: {
    state: "resting",
    density: "comfortable",
    truncate: false,
  },
});
