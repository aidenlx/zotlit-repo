import "./selection-control.css";
import { tv } from "@zotlit/plugin-kernel/tw.ts";

import { cn } from "#utils.ts";

const captionIcon = "zt:[--icon-size:var(--icon-xs)] zt:[--icon-stroke:1.5]";
export const selectionControl = tv({
  base: "clickable-icon",
  variants: {
    kind: {
      icon: cn("zt:shrink-0", captionIcon),
      trigger: cn(
        "zt-selection-trigger zt:max-w-full zt:min-w-0 zt:gap-1.5 zt:text-start zt:leading-normal zt:[&_svg]:shrink-0",
        captionIcon,
      ),
      option: "zt-selection-option zt:min-w-0 zt:[--clickable-icon-radius:0px]",
    },
  },
});
