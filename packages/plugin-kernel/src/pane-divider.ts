import { tv } from "#tw.ts";

export const paneDivider = tv({
  base: [
    "zt:z-(--layer-cover) zt:shrink-0 zt:touch-none zt:outline-none zt:select-none",
    "zt:border-(--divider-color) zt:bg-transparent",
    "zt:transition-[background-color,border-color,opacity] zt:duration-200 zt:ease-[ease-in-out]",
    "zt:hover:border-(--divider-color-hover) zt:hover:bg-(--divider-color-hover)",
    "zt:focus-visible:border-(--divider-color-hover) zt:focus-visible:bg-(--divider-color-hover)",
    "zt:[&.is-active:not(:hover),&[data-dragging]:not(:hover)]:border-(--color-accent) zt:[&.is-active:not(:hover),&[data-dragging]:not(:hover)]:bg-(--color-accent)",
  ],
  variants: {
    edge: {
      start:
        "zt:w-(--divider-width-hover) zt:cursor-col-resize zt:border-s-(length:--divider-width)",
      end: "zt:w-(--divider-width-hover) zt:cursor-col-resize zt:border-e-(length:--divider-width)",
      top: "zt:h-(--divider-width-hover) zt:cursor-row-resize zt:border-t-(length:--divider-width)",
      bottom:
        "zt:h-(--divider-width-hover) zt:cursor-row-resize zt:border-b-(length:--divider-width)",
    },
    flow: {
      overlay: "zt:absolute",
      inline: "zt:relative",
    },
  },
  compoundVariants: [
    { flow: "overlay", edge: "start", class: "zt:inset-y-0 zt:start-0" },
    { flow: "overlay", edge: "end", class: "zt:inset-y-0 zt:end-0" },
    { flow: "overlay", edge: "top", class: "zt:inset-x-0 zt:top-0" },
    { flow: "overlay", edge: "bottom", class: "zt:inset-x-0 zt:bottom-0" },
    {
      flow: "inline",
      edge: "end",
      class: "zt:ms-[calc(var(--divider-width)-var(--divider-width-hover))]",
    },
    {
      flow: "inline",
      edge: "bottom",
      class: "zt:mt-[calc(var(--divider-width)-var(--divider-width-hover))]",
    },
  ],
});
