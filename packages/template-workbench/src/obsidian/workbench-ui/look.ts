// The class building blocks the Workbench UI shares: its buttons, panes,
// boxes and drag rows, which the components compose with `zt:` utilities and
// the Selection UI of the editor unit reads too.
import { selectionControl } from "@zotlit/obsidian-kit/components/obsidian/selection-control.ts";
import { cn } from "@zotlit/obsidian-kit/utils.ts";
import { tv } from "@zotlit/plugin-kernel/tw.ts";

/** Text actions share the Match tab's outlined native control surface. */
export const templateWorkbenchButton =
  "zt:inline-flex zt:items-center zt:gap-1.5 zt:whitespace-normal zt:text-start zt:text-muted-foreground";
/**
 * Shared-template scope and its originating-note action form one compact notice.
 * The guidance reads first at the full width, and the note it updates sits
 * below it with the action. Template and note names come from the vault, so
 * each one wraps anywhere.
 */
/**
 * The width each column's handle takes between the column and the editor,
 * in pixels: the line of Obsidian's `--divider-width` that the `edge` part's
 * pane divider shows; its strip overlaps the column. The placement counts it.
 */
export const PANEL_HANDLE_WIDTH = 1;

export const originatingNoteNotice = {
  root: "zt:mx-3 zt:mb-2 zt:flex zt:min-w-0 zt:flex-col zt:gap-2 zt:border-s-2 zt:border-(--interactive-accent) zt:bg-(--background-secondary) zt:px-3 zt:py-2 zt:text-xs zt:leading-normal",
  guidance: "zt:min-w-0 zt:space-y-0.5",
  scope:
    "zt:font-medium zt:text-pretty zt:text-foreground zt:[overflow-wrap:anywhere]",
  behavior: "zt:text-pretty zt:text-muted-foreground",
  action: "zt:flex zt:min-w-0 zt:flex-wrap zt:items-center zt:gap-2",
  note: "zt:flex zt:min-w-0 zt:flex-1 zt:items-center zt:gap-1.5 zt:font-medium zt:text-foreground zt:[--icon-size:var(--icon-xs)] zt:[&_svg]:shrink-0 zt:[&_svg]:text-muted-foreground",
  "note-name": "zt:min-w-0 zt:[overflow-wrap:anywhere]",
  button: cn(templateWorkbenchButton, "zt:ms-auto zt:shrink-0"),
  /** Both labels share one cell, so the button keeps its width while it updates. */
  labels: "zt:grid zt:[&>*]:col-start-1 zt:[&>*]:row-start-1",
  "label-hidden": "zt:invisible",
} as const;
/**
 * A control that hands its own box to the content inside it. `.clickable-icon`
 * and `button` are styled unlayered, so their padding, centering, wrapping and
 * weight outrank every `zt:` utility; a full-width child turns the centering
 * into a no-op and takes those declarations back for Tailwind.
 */
const controlContent = "zt:flex zt:w-full zt:min-w-0 zt:whitespace-normal";
/**
 * The empty state's own way into the library, which wears Obsidian's native
 * button surface so it stays legible on the light pane background the flat
 * `clickable-icon` controls disappear into.
 */
export const selectionSearch = "zt:w-full";
/** Its label sits beside the icon on one line, the height Obsidian gives it. */
export const selectionSearchContent = cn(
  controlContent,
  "zt:items-center zt:gap-2 zt:[--icon-size:var(--icon-s)] zt:[--icon-stroke:1.5] zt:[&_svg]:shrink-0",
);
/** Choices read as one boxed list, so the group itself carries the structure. */
export const selectionList =
  "zt:flex zt:min-w-0 zt:flex-col zt:overflow-hidden zt:rounded-md zt:border zt:border-border";
/** A choice names itself on the first line and its hint on the second. */
export const selectionOptionContent = cn(
  controlContent,
  "zt:flex-col zt:gap-0.5 zt:px-1.5 zt:py-1 zt:text-start zt:leading-snug zt:font-normal",
);
/** A choice's own name, which the hint beneath it is subordinate to. */
export const selectionOptionLabel = "zt:font-medium zt:text-foreground";
/**
 * A control row that names the selected data beside the control that changes it.
 * In a sidebar placement, the row shows only where Obsidian hides the view header.
 */
export const selectionBar = tv({
  slots: {
    row: "zt:min-w-0 zt:flex-wrap zt:items-center zt:gap-x-2 zt:gap-y-1",
    /** The selected data reads as a muted caption, subordinate to the result. */
    caption:
      "zt:min-w-0 zt:flex-1 zt:py-2 zt:text-xs zt:leading-normal zt:text-pretty zt:text-muted-foreground",
    trigger: [selectionControl({ kind: "trigger" }), "zt:ms-auto"],
  },
  variants: {
    placement: {
      /** A row inside the result appears only where Obsidian hides the view header. */
      sidebar: { row: "zt-workbench-sidebar-control" },
    },
  },
});
/** A group of selection choices: its heading, then its options. */
export const selectionGroup = "zt:flex zt:min-w-0 zt:flex-col";
/** A group heading names the source the options beneath it come from. */
export const selectionGroupHeading =
  "zt:mb-1.5 zt:px-0.5 zt:text-xs zt:font-semibold zt:leading-normal zt:text-muted-foreground";
const hint =
  "zt:text-xs zt:leading-normal zt:text-muted-foreground zt:text-pretty";
/** Guidance and status read at hint size wherever the selection UI states a task. */
export const selectionHint = hint;
/**
 * A sticky part that covers what scrolls under it wears the ground of the
 * pane it stands in: a sidebar's own in a sidebar, else the main area's. A
 * surface with a ground of its own, as the Fields popover, sets
 * `--zt-pane-ground` itself.
 */
export const paneCover =
  "zt:bg-(--zt-pane-ground,var(--background-primary)) zt:in-[.mod-sidedock]:[--zt-pane-ground:var(--background-secondary)]";
/**
 * A boxed pane wears Obsidian's text-input surface, focus ring included. Its
 * border, padding and ring read the `--input-*` variables a native input
 * reads, so a host that draws the box itself zeroes them.
 */
export const editorBox =
  "zt:rounded-(--input-radius) zt:border-(length:--input-border-width) zt:border-solid zt:border-border zt:bg-input zt:p-(--input-padding) zt:focus-within:border-border-focus zt:focus-within:shadow-[0_0_0_var(--input-border-width-focus)_var(--background-modifier-border-focus)]";
/** In-editor chrome — labels and boxes CodeMirror paints between lines — reads in the interface font. */
export const editorChip =
  "zt:rounded-sm zt:border zt:border-border zt:bg-card zt:font-sans zt:text-xs zt:font-medium zt:leading-tight zt:text-muted-foreground";
/** An icon button small enough to sit inside a chip. */
export const chipIcon = "clickable-icon zt:p-1 zt:[--icon-size:var(--icon-xs)]";
/** A one-line bar of chrome: a heading, a hint, and an action at the end. */
export const bar =
  "zt:flex zt:flex-wrap zt:items-center zt:gap-x-3 zt:gap-y-1 zt:rounded-md zt:border zt:border-border zt:bg-card zt:px-2.5 zt:py-1.5 zt:text-xs";
/**
 * A row that drags by its handle: it fades while it moves, and an accent line
 * centred in the gap beside it marks the place it lands. The line is the row's
 * positioned `::before`, so it takes no room and nothing moves. A list whose
 * rows sit further apart than `gap-2` sets `--zt-row-gap`, and a row with a
 * border sets `--zt-row-border`, since the line is placed from inside it. The
 * Match tree and the Properties list share it.
 */
export const dragRow = [
  "zt:relative zt:data-dragging:opacity-50",
  "zt:before:pointer-events-none zt:before:absolute zt:before:inset-x-0 zt:before:hidden zt:before:h-(--size-2-1) zt:before:rounded-full zt:before:bg-(--interactive-accent)",
  "zt:data-[drop=before]:before:block zt:data-[drop=before]:before:top-[calc(-0.5*(var(--zt-row-gap,0.5rem)+var(--size-2-1))-var(--zt-row-border,0px))]",
  "zt:data-[drop=after]:before:block zt:data-[drop=after]:before:bottom-[calc(-0.5*(var(--zt-row-gap,0.5rem)+var(--size-2-1))-var(--zt-row-border,0px))]",
];
/**
 * The grip a row drags by, drawn as the Bases grip: faint, shown while the
 * pointer is over its own row or it has focus; a disabled editor has none.
 */
export const dragHandle = [
  "zt:flex zt:shrink-0 zt:cursor-grab zt:items-center zt:rounded-sm zt:text-faint zt:hover:text-muted-foreground zt:active:cursor-grabbing",
  "zt:opacity-0 zt:focus-visible:opacity-100 zt:aria-disabled:hidden",
  "zt:focus-visible:shadow-[0_0_0_var(--input-border-width-focus)_var(--background-modifier-border-focus)] zt:focus-visible:outline-none",
];
/**
 * The rows of a Match tree as the Bases filter menu draws them: a grip, the
 * conjunction, then the condition, where a nested group spans the last two.
 * In a drag, the row that moves fades, an accent line marks the place it
 * lands, and an empty group that takes it shows the focus ring. `look` sets
 * each host's conjunction column and gaps.
 */
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
/**
 * The shared accent-bar treatment every inline preview notice wears: a bar
 * states which condition, and the box holds the sentence and its action.
 */
export const previewNotice =
  "zt:flex zt:min-w-0 zt:gap-x-3 zt:gap-y-1 zt:border-s-2 zt:bg-(--background-secondary) zt:px-3 zt:py-2 zt:text-xs zt:leading-normal";
