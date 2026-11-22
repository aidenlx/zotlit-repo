import { iconButton } from "@zotlit/obsidian-kit/components/obsidian/icon-button.tsx";
import { selectionControl } from "@zotlit/obsidian-kit/components/obsidian/selection-control.ts";
import { cn } from "@zotlit/obsidian-kit/utils.ts";
import { tv } from "@zotlit/plugin-kernel/tw.ts";

export const templateWorkbenchButton =
  "zt:inline-flex zt:items-center zt:gap-1.5 zt:whitespace-normal zt:text-start zt:text-muted-foreground";
export const originatingNoteNotice = {
  root: "zt:mx-3 zt:mb-2 zt:flex zt:min-w-0 zt:flex-col zt:gap-2 zt:border-s-2 zt:border-primary zt:bg-(--background-secondary) zt:px-3 zt:py-2 zt:text-xs zt:leading-normal",
  guidance: "zt:min-w-0 zt:space-y-0.5",
  scope:
    "zt:font-medium zt:text-pretty zt:text-foreground zt:[overflow-wrap:anywhere]",
  behavior: "zt:text-pretty zt:text-muted-foreground",
  action: "zt:flex zt:min-w-0 zt:flex-wrap zt:items-center zt:gap-2",
  note: "zt:flex zt:min-w-0 zt:flex-1 zt:items-center zt:gap-1.5 zt:font-medium zt:text-foreground zt:[--icon-size:var(--icon-xs)] zt:[&_svg]:shrink-0 zt:[&_svg]:text-muted-foreground",
  "note-name": "zt:min-w-0 zt:[overflow-wrap:anywhere]",
  button: cn(templateWorkbenchButton, "zt:ms-auto zt:shrink-0"),
  labels: "zt:grid zt:[&>*]:col-start-1 zt:[&>*]:row-start-1",
  "label-hidden": "zt:invisible",
} as const;
const controlContent = "zt:flex zt:w-full zt:min-w-0 zt:whitespace-normal";
export const selectionSearch = "zt:w-full";
export const selectionSearchContent = cn(
  controlContent,
  "zt:items-center zt:gap-2 zt:[--icon-size:var(--icon-s)] zt:[--icon-stroke:1.5] zt:[&_svg]:shrink-0",
);
export const selectionList =
  "zt:flex zt:min-w-0 zt:flex-col zt:overflow-hidden zt:rounded-md zt:border zt:border-border";
export const selectionOptionContent = cn(
  controlContent,
  "zt:flex-col zt:gap-0.5 zt:px-1.5 zt:py-1 zt:text-start zt:leading-snug zt:font-normal",
);
export const selectionOptionLabel = "zt:font-medium zt:text-foreground";
export const selectionBar = tv({
  slots: {
    row: "zt:min-w-0 zt:flex-wrap zt:items-center zt:gap-x-2 zt:gap-y-1",
    caption:
      "zt:min-w-0 zt:flex-1 zt:py-2 zt:text-xs zt:leading-normal zt:text-pretty zt:text-muted-foreground",
    trigger: [selectionControl({ kind: "trigger" }), "zt:ms-auto"],
  },
  variants: {
    placement: {
      sidebar: { row: "zt-workbench-sidebar-control" },
    },
  },
});
export const selectionGroup = "zt:flex zt:min-w-0 zt:flex-col";
export const selectionGroupHeading =
  "zt:mb-1.5 zt:px-0.5 zt:text-xs zt:font-semibold zt:leading-normal zt:text-muted-foreground";
const hint =
  "zt:text-xs zt:leading-normal zt:text-muted-foreground zt:text-pretty";
export const selectionHint = hint;
export const paneCover =
  "zt:bg-(--zt-pane-ground,var(--background-primary)) zt:in-[.mod-sidedock]:[--zt-pane-ground:var(--background-secondary)]";
export const editorBox =
  "zt:rounded-(--input-radius) zt:border-(length:--input-border-width) zt:border-solid zt:border-border zt:bg-input zt:p-(--input-padding) zt:focus-within:border-border-focus zt:focus-within:shadow-[0_0_0_var(--input-border-width-focus)_var(--background-modifier-border-focus)]";
export const editorChip =
  "zt:rounded-sm zt:border zt:border-border zt:bg-card zt:font-sans zt:text-xs zt:font-medium zt:leading-tight zt:text-muted-foreground";
export const chipIcon = iconButton({
  className: "zt:p-1 zt:[--icon-size:var(--icon-xs)]",
});
export const bar =
  "zt:flex zt:flex-wrap zt:items-center zt:gap-x-3 zt:gap-y-1 zt:rounded-md zt:border zt:border-border zt:bg-card zt:px-2.5 zt:py-1.5 zt:text-xs";
export const dragRow = [
  "zt:relative zt:data-dragging:opacity-50",
  "zt:before:pointer-events-none zt:before:absolute zt:before:inset-x-0 zt:before:hidden zt:before:h-(--size-2-1) zt:before:rounded-full zt:before:bg-primary",
  "zt:data-[drop=before]:before:block zt:data-[drop=before]:before:top-[calc(-0.5*(var(--zt-row-gap,0.5rem)+var(--size-2-1))-var(--zt-row-border,0px))]",
  "zt:data-[drop=after]:before:block zt:data-[drop=after]:before:bottom-[calc(-0.5*(var(--zt-row-gap,0.5rem)+var(--size-2-1))-var(--zt-row-border,0px))]",
];
export const dragHandle = [
  "zt:flex zt:shrink-0 zt:cursor-grab zt:items-center zt:rounded-sm zt:text-faint zt:hover:text-muted-foreground zt:active:cursor-grabbing",
  "zt:opacity-0 zt:focus-visible:opacity-100 zt:aria-disabled:hidden",
  "zt:focus-visible:shadow-[0_0_0_var(--input-border-width-focus)_var(--background-modifier-border-focus)] zt:focus-visible:outline-none",
];
export const matchRows = tv({
  slots: {
    row: [
      "zt:grid zt:min-w-0 zt:items-start zt:[&:hover>[data-part=handle]]:opacity-100 zt:[&>[data-part=group]]:col-span-2",
      dragRow,
    ],
    handle: [
      "zt:me-[calc(-1*var(--size-2-1))] zt:min-h-(--input-height)",
      ...dragHandle,
    ],
    group: "zt:data-[drop=into]:shadow-(--metadata-property-box-shadow-focus)",
  },
  variants: {
    look: {
      workbench: { row: "zt:grid-cols-[auto_4.5rem_minmax(0,1fr)] zt:gap-2" },
      filter: {
        row: "zt:grid-cols-[auto_var(--size-4-18)_minmax(0,1fr)] zt:gap-(--size-4-2) zt:[--zt-row-gap:var(--size-2-3)]",
      },
    },
  },
});
export const workbenchRows = matchRows({ look: "workbench" });
export const previewNotice =
  "zt:flex zt:min-w-0 zt:gap-x-3 zt:gap-y-1 zt:border-s-2 zt:bg-(--background-secondary) zt:px-3 zt:py-2 zt:text-xs zt:leading-normal";
