import type { EditingCapability } from "#obsidian/annotation-repository/capability.ts";
import type { IconName } from "obsidian";

import { themeHook } from "@zotlit/plugin-kernel/theme-hooks.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import { renderIconButton, updateIconButton } from "./icon-button.ts";
import type { MarkTool } from "./tools.ts";
import { MARK_TOOLS } from "./tools.ts";
import "./style.css";

import { editingBlockedReason } from "#obsidian/annot-view/card-controls.ts";
import { IDLE } from "#obsidian/annotation-repository/write.ts";

const LAYOUT_CLASSES = ["zt:flex", "zt:items-center", "zt:gap-0.5"];

const SPLIT_CLASSES = [themeHook.pdfTool, "zt:flex", "zt:items-stretch"];

export type CreationToolbarControlId =
  | MarkTool
  | `${MarkTool}-color`
  | "visibility";

export interface CreationToolbarControl {
  id: CreationToolbarControlId;
  icon: IconName;
  tooltip: string;
  pressed: boolean | null;
  disabled: boolean;
  split: MarkTool | null;
  color: string | null;
}

export interface CreationToolbarProps {
  armed: MarkTool | null;
  colors: Readonly<Record<MarkTool, string>>;
  marksVisible: boolean;
  capability: EditingCapability;
  now: Temporal.Instant;
}

const TOOL_FACE: Record<MarkTool, { icon: IconName; label: () => string }> = {
  highlight: { icon: "highlighter", label: m.pdf_toolbar_highlight },
  underline: { icon: "underline", label: m.pdf_toolbar_underline },
  note: { icon: "sticky-note", label: m.pdf_toolbar_note },
  text: { icon: "type", label: m.pdf_toolbar_text },
  image: { icon: "square-dashed-mouse-pointer", label: m.pdf_toolbar_image },
  ink: { icon: "pencil", label: m.pdf_toolbar_ink },
};

export function creationToolbar({
  armed,
  colors,
  marksVisible,
  capability,
  now,
}: CreationToolbarProps): readonly CreationToolbarControl[] {
  const blocked = editingBlockedReason(capability, IDLE, now);
  const tool = (id: MarkTool): CreationToolbarControl[] => {
    const { icon, label } = TOOL_FACE[id];
    const name = label();
    const half = { disabled: blocked !== null, split: id };
    return [
      {
        ...half,
        id,
        icon,
        tooltip: blocked ?? name,
        pressed: armed === id,
        color: colors[id],
      },
      {
        ...half,
        id: `${id}-color`,
        icon: "chevron-down",
        tooltip: blocked ?? m.pdf_toolbar_tool_color({ tool: name }),
        pressed: null,
        color: null,
      },
    ];
  };
  return [
    ...MARK_TOOLS.flatMap(tool),
    {
      id: "visibility",
      icon: marksVisible ? "eye" : "eye-off",
      tooltip: marksVisible
        ? m.pdf_toolbar_hide_marks()
        : m.pdf_toolbar_show_marks(),
      pressed: marksVisible,
      disabled: false,
      split: null,
      color: null,
    },
  ];
}

export type CreationToolbarActivate = (
  id: CreationToolbarControlId,
  node: HTMLElement,
) => void;

export interface CreationToolbarNodes {
  root: HTMLElement;
  capabilitySlot: HTMLElement;
}

interface ToolbarShape extends CreationToolbarNodes {
  tools: HTMLElement;
  actions: HTMLElement;
}

let groupSerial = 0;

const drawn = new WeakMap<
  HTMLElement,
  {
    controls: ReadonlyMap<CreationToolbarControlId, CreationToolbarControl>;
    activate: CreationToolbarActivate;
  }
>();

export function renderCreationToolbar(
  slot: HTMLElement,
  controls: readonly CreationToolbarControl[],
  activate: CreationToolbarActivate,
): CreationToolbarNodes {
  const shape = toolbarIn(slot) ?? createToolbar(slot);
  drawn.set(shape.root, {
    controls: new Map(controls.map((control) => [control.id, control])),
    activate,
  });
  const seats = new Map<MarkTool, HTMLElement>();

  for (const control of controls) {
    const node =
      shape.root.querySelector<HTMLElement>(`[data-zt-tool="${control.id}"]`) ??
      buildControl(shape, seats, control);
    updateIconButton(node, control);
    if (control.split === null) continue;
    node.removeClass("is-active");
    if (control.pressed !== null)
      node.parentElement?.toggleClass("is-active", control.pressed);
  }
  return { root: shape.root, capabilitySlot: shape.capabilitySlot };
}

function buildControl(
  shape: ToolbarShape,
  seats: Map<MarkTool, HTMLElement>,
  { id, icon, tooltip, split }: CreationToolbarControl,
): HTMLElement {
  const node = renderIconButton(
    seatFor(shape, seats, split),
    { icon, tooltip },
    (pressed) => {
      const last = drawn.get(shape.root);
      if (last?.controls.get(id)?.disabled === false)
        last.activate(id, pressed);
    },
  );
  node.dataset.ztTool = id;
  return node;
}

export function removeCreationToolbar(slot: HTMLElement): void {
  toolbarIn(slot)?.root.remove();
}

function seatFor(
  shape: ToolbarShape,
  seats: Map<MarkTool, HTMLElement>,
  split: MarkTool | null,
): HTMLElement {
  if (split === null) return shape.actions;
  const seat =
    seats.get(split) ?? shape.tools.createDiv({ cls: SPLIT_CLASSES });
  seats.set(split, seat);
  return seat;
}

function toolbarIn(slot: HTMLElement): ToolbarShape | null {
  const root = slot.querySelector<HTMLElement>(
    `:scope > .${themeHook.pdfCreationToolbar}`,
  );
  if (!root) return null;
  const [, tools, actions, capabilitySlot] = root.children;
  return tools?.instanceOf(HTMLElement) &&
    actions?.instanceOf(HTMLElement) &&
    capabilitySlot?.instanceOf(HTMLElement)
    ? { root, tools, actions, capabilitySlot }
    : null;
}

function createToolbar(slot: HTMLElement): ToolbarShape {
  const root = slot.createDiv({
    cls: [
      themeHook.pdfCreationToolbar,
      ...LAYOUT_CLASSES,
      "zt:flex-wrap",
      "zt:min-w-0",
    ],
  });
  const label = root.createSpan({
    cls: "zt:sr-only",
    text: m.pdf_toolbar_tools(),
    attr: { id: `zt-pdf-tool-group-${++groupSerial}` },
  });
  const tools = root.createDiv({
    cls: LAYOUT_CLASSES,
    attr: { role: "group", "aria-labelledby": label.id },
  });
  const actions = root.createDiv({ cls: LAYOUT_CLASSES });
  const capabilitySlot = root.createDiv({ cls: LAYOUT_CLASSES });
  return { root, tools, actions, capabilitySlot };
}
