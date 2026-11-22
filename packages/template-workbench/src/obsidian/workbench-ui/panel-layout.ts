import * as m from "@zotlit/plugin-messages/messages.ts";

import { patchAt } from "./patch.ts";

export type PanelSide = "fields" | "preview";
export interface WorkbenchPanel {
  readonly shown: boolean;
  readonly width: number;
}
export interface PreviewPanel extends WorkbenchPanel {
  readonly height: number;
}
export interface FieldsDock {
  readonly pinned: boolean;
  readonly hidden: boolean;
  readonly width: number;
}
export interface WorkbenchPanels {
  readonly fields: FieldsDock;
  readonly preview: PreviewPanel;
}

export const PANEL_WIDTH = { min: 240, initial: 400, max: 960 } as const;

export const PREVIEW_SIDE_MIN = 896;

export const PREVIEW_HEIGHT = { min: 20, initial: 40, max: 80 } as const;

export const EDITOR_MIN = { width: 360, height: 320 } as const;

export const FIELDS_WIDTH = { min: 240, initial: 320, max: 480 } as const;

export const PANEL_HANDLE_WIDTH = 1;

export const INITIAL_PANELS: WorkbenchPanels = {
  fields: { pinned: false, hidden: false, width: FIELDS_WIDTH.initial },
  preview: {
    shown: false,
    width: PANEL_WIDTH.initial,
    height: PREVIEW_HEIGHT.initial,
  },
};

export const clampPanelWidth = (width: number, max: number = PANEL_WIDTH.max) =>
  Math.round(
    Math.min(Math.max(PANEL_WIDTH.min, max), Math.max(PANEL_WIDTH.min, width)),
  );

export const savedPanelWidth = (side: PanelSide, width: number) => {
  const { width: widths, savedMax } = PANEL_SIDES[side];
  return Math.round(Math.min(savedMax, Math.max(widths.min, width)));
};

export const clampPreviewHeight = (share: number) =>
  Math.round(Math.min(PREVIEW_HEIGHT.max, Math.max(PREVIEW_HEIGHT.min, share)));

export const showPreview = (shown: boolean) =>
  patchAt<WorkbenchPanels, "preview">("preview", { shown });
export const setPanelWidth = (side: PanelSide, width: number) =>
  patchAt<WorkbenchPanels, PanelSide>(side, {
    width: savedPanelWidth(side, width),
  });
export const pinFields = (pinned: boolean) =>
  patchAt<WorkbenchPanels, "fields">("fields", { pinned, hidden: false });
export const hideFields = (hidden: boolean) =>
  patchAt<WorkbenchPanels, "fields">("fields", { hidden });
export const setPreviewHeight = (share: number) =>
  patchAt<WorkbenchPanels, "preview">("preview", {
    height: clampPreviewHeight(share),
  });

export interface ViewSize {
  readonly width: number;
  readonly height: number;
  readonly handle?: number;
}

export type FieldsPlacement = "docked" | "popover" | "closed";

export interface PanelPlacement {
  readonly preview: "side" | "below" | "hidden";
  readonly fields: FieldsPlacement;
  readonly canPin: boolean;
}

export type FieldsPanelState = "open" | "closed" | "to-editor";

export interface FieldsPin {
  readonly pinned: boolean;
  readonly canPin: boolean;
}

const previewPlace = (
  panels: WorkbenchPanels,
  size: ViewSize | null,
): PanelPlacement["preview"] =>
  !panels.preview.shown
    ? "hidden"
    : size === null || size.width >= PREVIEW_SIDE_MIN
      ? "side"
      : "below";

const previewLimit = (panels: WorkbenchPanels, size: ViewSize | null) =>
  size
    ? Math.max(
        PANEL_WIDTH.min,
        size.width - EDITOR_MIN.width - (size.handle ?? 0),
      )
    : Math.max(PANEL_WIDTH.max, panels.preview.width);

const fieldsRoom = (panels: WorkbenchPanels, size: ViewSize) =>
  size.width -
  (previewPlace(panels, size) === "side"
    ? clampPanelWidth(panels.preview.width, previewLimit(panels, size)) +
      (size.handle ?? 0)
    : 0);

const fieldsLimit = (panels: WorkbenchPanels, size: ViewSize | null) =>
  size
    ? Math.min(
        FIELDS_WIDTH.max,
        Math.max(
          FIELDS_WIDTH.min,
          fieldsRoom(panels, size) - (size.handle ?? 0) - EDITOR_MIN.width,
        ),
      )
    : FIELDS_WIDTH.max;

export interface SideColumn {
  readonly width: {
    readonly min: number;
    readonly initial: number;
    readonly max: number;
  };
  readonly savedMax: number;
  readonly edge: "leading" | "trailing";
  readonly limit: (panels: WorkbenchPanels, size: ViewSize | null) => number;
  readonly placed: (placement: PanelPlacement) => boolean;
  readonly label: () => string;
  readonly resizeLabel: () => string;
}

export const PANEL_SIDES: Readonly<Record<PanelSide, SideColumn>> = {
  fields: {
    width: FIELDS_WIDTH,
    savedMax: FIELDS_WIDTH.max,
    edge: "leading",
    limit: (panels, size) => fieldsLimit(panels, size),
    placed: (placement) => placement.fields === "docked",
    label: m.workbench_view_fields,
    resizeLabel: m.workbench_fields_resize,
  },
  preview: {
    width: PANEL_WIDTH,
    savedMax: Number.POSITIVE_INFINITY,
    edge: "trailing",
    limit: (panels, size) => previewLimit(panels, size),
    placed: (placement) => placement.preview === "side",
    label: m.workbench_view_preview,
    resizeLabel: m.workbench_preview_resize,
  },
};

const otherSide = (side: PanelSide): PanelSide =>
  (Object.keys(PANEL_SIDES) as PanelSide[]).find((other) => other !== side)!;

const drawnWidth = (
  panels: WorkbenchPanels,
  side: PanelSide,
  size: ViewSize | null,
) => clampPanelWidth(panels[side].width, PANEL_SIDES[side].limit(panels, size));

export function placePanels(
  panels: WorkbenchPanels,
  size: ViewSize | null,
  fieldsOpen: boolean,
): PanelPlacement {
  const canPin =
    size === null ||
    fieldsRoom(panels, size) - (size.handle ?? 0) >=
      FIELDS_WIDTH.min + EDITOR_MIN.width;
  const { pinned, hidden } = panels.fields;
  return {
    preview: previewPlace(panels, size),
    fields:
      pinned && !hidden && canPin
        ? "docked"
        : fieldsOpen
          ? "popover"
          : "closed",
    canPin,
  };
}

export const previewBelowHeight = (share: number, viewHeight: number) =>
  Math.max(
    0,
    Math.min(
      Math.round((viewHeight * share) / 100),
      viewHeight - EDITOR_MIN.height,
    ),
  );

export type PanelHandle = PanelSide | "split";
export type PanelResize = "grow" | "shrink" | "reset";

const KEY_STEP = { width: 16, wideWidth: 64, height: 5 } as const;

const MENU_STEP = {
  width: KEY_STEP.wideWidth,
  height: KEY_STEP.height * 2,
} as const;

export function panelHandles(
  panels: WorkbenchPanels,
  size: ViewSize | null,
): readonly PanelHandle[] {
  const { preview, fields } = placePanels(panels, size, false);
  const handles: PanelHandle[] = [];
  if (fields === "docked") handles.push("fields");
  if (preview === "side") handles.push("preview");
  if (preview === "below") handles.push("split");
  return handles;
}

export function columnLimit(
  panels: WorkbenchPanels,
  side: PanelSide,
  size: ViewSize | null,
): number {
  const limit = PANEL_SIDES[side].limit(panels, size);
  if (size === null) return limit;
  const placement = placePanels(panels, size, false);
  const other = otherSide(side);
  if (
    !PANEL_SIDES[side].placed(placement) ||
    !PANEL_SIDES[other].placed(placement)
  )
    return limit;
  const handle = size.handle ?? 0;
  return clampPanelWidth(
    size.width -
      EDITOR_MIN.width -
      handle -
      (drawnWidth(panels, other, size) + handle),
    limit,
  );
}

const drawnShare = (panels: WorkbenchPanels, size: ViewSize | null) =>
  size && size.height > 0
    ? Math.min(
        panels.preview.height,
        Math.round(
          (previewBelowHeight(panels.preview.height, size.height) * 100) /
            size.height,
        ),
      )
    : panels.preview.height;

export interface HandleSizing {
  readonly side: PanelSide;
  readonly axis: "horizontal" | "vertical";
  readonly unit: "px" | "%";
  readonly drawn: (panels: WorkbenchPanels, size: ViewSize | null) => number;
  readonly stored: (panels: WorkbenchPanels) => number;
  readonly min: number;
  readonly max: (panels: WorkbenchPanels, size: ViewSize | null) => number;
  readonly steps: {
    readonly key: number;
    readonly wide: number;
    readonly menu: number;
  };
  readonly write: (
    next: number,
    size: ViewSize | null,
  ) => (panels: WorkbenchPanels) => WorkbenchPanels;
  readonly pixels: (panels: WorkbenchPanels, size: ViewSize | null) => number;
  readonly fromPixels: (pixels: number, size: ViewSize | null) => number;
}

const columnHandle = (side: PanelSide): HandleSizing => {
  const drawn = (panels: WorkbenchPanels, size: ViewSize | null) =>
    clampPanelWidth(panels[side].width, columnLimit(panels, side, size));
  return {
    side,
    axis: "horizontal",
    unit: "px",
    drawn,
    stored: (panels) => panels[side].width,
    min: PANEL_SIDES[side].width.min,
    max: (panels, size) => columnLimit(panels, side, size),
    steps: {
      key: KEY_STEP.width,
      wide: KEY_STEP.wideWidth,
      menu: MENU_STEP.width,
    },
    write: (next, size) => (panels) =>
      setPanelWidth(
        side,
        clampPanelWidth(next, columnLimit(panels, side, size)),
      )(panels),
    pixels: drawn,
    fromPixels: (pixels) => pixels,
  };
};

export const PANEL_HANDLES: Readonly<Record<PanelHandle, HandleSizing>> = {
  fields: columnHandle("fields"),
  preview: columnHandle("preview"),
  split: {
    side: "preview",
    axis: "vertical",
    unit: "%",
    drawn: drawnShare,
    stored: (panels) => panels.preview.height,
    min: PREVIEW_HEIGHT.min,
    max: () => PREVIEW_HEIGHT.max,
    steps: {
      key: KEY_STEP.height,
      wide: KEY_STEP.height,
      menu: MENU_STEP.height,
    },
    write: (next) => setPreviewHeight(next),
    pixels: (panels, size) =>
      previewBelowHeight(panels.preview.height, size?.height ?? 0),
    fromPixels: (pixels, size) =>
      size && size.height > 0 ? (pixels / size.height) * 100 : 0,
  },
};

export interface PanelBounds {
  readonly size: ViewSize | null;
  readonly defaults: WorkbenchPanels;
}

export type PanelStep = keyof HandleSizing["steps"];
export type PanelMove = PanelResize | "min" | "max";

export function drawnMax(
  handle: PanelHandle,
  panels: WorkbenchPanels,
  size: ViewSize | null,
): number {
  const sizing = PANEL_HANDLES[handle];
  return sizing.drawn(
    sizing.write(sizing.max(panels, size), size)(panels),
    size,
  );
}

export interface PanelMoveBounds extends PanelBounds {
  readonly step?: PanelStep;
}

export function resizePanel(
  handle: PanelHandle,
  move: PanelMove,
  { size, defaults, step = "menu" }: PanelMoveBounds,
): (panels: WorkbenchPanels) => WorkbenchPanels {
  const sizing = PANEL_HANDLES[handle];
  const by = sizing.steps[step];
  return (panels) =>
    sizing.write(
      move === "reset"
        ? sizing.stored(defaults)
        : move === "min"
          ? sizing.min
          : move === "max"
            ? sizing.max(panels, size)
            : sizing.drawn(panels, size) + (move === "grow" ? by : -by),
      size,
    )(panels);
}

export function canResizePanel(
  handle: PanelHandle,
  resize: PanelResize,
  bounds: PanelBounds,
): (panels: WorkbenchPanels) => boolean {
  const sizing = PANEL_HANDLES[handle];
  const apply = resizePanel(handle, resize, bounds);
  const measure =
    resize === "reset"
      ? sizing.stored
      : (panels: WorkbenchPanels) => sizing.drawn(panels, bounds.size);
  return (panels) => measure(apply(panels)) !== measure(panels);
}
