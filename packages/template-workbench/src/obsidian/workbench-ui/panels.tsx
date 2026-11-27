import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { KeyboardEvent, PointerEvent, ReactNode, RefObject } from "react";
import { useLayoutEffect, useRef, useState } from "react";

import { paneDivider } from "@zotlit/plugin-kernel/pane-divider.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { runtime } from "@zotlit/plugin-messages/runtime.ts";
import { useUniqueId } from "@zotlit/ui";

import { useWorkbenchEditor, useWorkbenchModel } from "./editor.tsx";
import {
  DockedFieldsPanel,
  fieldsDockId,
  FieldsPopoverPanel,
} from "./fields-panel.tsx";
import { useContainerName, useWorkbenchHost } from "./host.tsx";
import type {
  HandleSizing,
  PanelHandle,
  PanelMove,
  PanelSide,
  ViewSize,
  WorkbenchPanels,
} from "./panel-layout.ts";
import {
  drawnMax,
  PANEL_HANDLES,
  PANEL_SIDES,
  resizePanel,
} from "./panel-layout.ts";

const panelsPanel =
  "zt:flex zt:min-h-0 zt:shrink-0 zt:flex-col zt:overflow-auto zt:data-[state=fields]:w-(--zt-panel-width) zt:data-[state=preview]:w-(--zt-panel-width) zt:data-[state=below]:h-(--zt-panel-height)";
const panelsStatus = "zt:sr-only";
const panelsEdge = paneDivider({ flow: "inline", edge: "end" });
const panelsSplit = paneDivider({ flow: "inline", edge: "bottom" });

export interface SidePanel {
  readonly label: string;
  readonly resizeLabel: string;
  readonly content: ReactNode;
}

interface FieldsSidePanel extends SidePanel {
  readonly actions?: ReactNode;
}

export function SidePanels({
  panels,
  children,
}: {
  panels: { readonly fields?: FieldsSidePanel; readonly preview?: SidePanel };
  children: ReactNode;
}) {
  const model = useWorkbenchModel();
  const state = useAtomValue(model.panels);
  const placement = useAtomValue(model.placement);
  const preview = panels.preview && state.preview.shown ? panels.preview : null;
  const below = placement.preview === "below";
  const host = useWorkbenchHost();
  const popoverId = host.fieldsAction?.popoverId;
  const fieldsTitle = useUniqueId();
  const dockHeldFocus = useRef(false);
  useLayoutEffect(() => {
    if (dockHeldFocus.current && placement.fields !== "docked")
      host.fieldsAction?.focus();
    dockHeldFocus.current = false;
  }, [placement.fields, host]);
  return (
    <div data-part="panels" className="zt:flex zt:h-full zt:min-w-0">
      {panels.fields && placement.fields === "docked" && (
        <Panel
          side="fields"
          below={false}
          label={panels.fields.label}
          labelledBy={fieldsTitle}
          resizeLabel={panels.fields.resizeLabel}
          {...(popoverId === undefined ? {} : { id: fieldsDockId(popoverId) })}
          onLeave={() => {
            dockHeldFocus.current = true;
          }}
          content={
            <DockedFieldsPanel {...panels.fields} titleId={fieldsTitle} />
          }
        />
      )}
      <div
        data-part="stack"
        data-state={below ? "below" : "side"}
        className="zt:flex zt:min-h-0 zt:min-w-0 zt:flex-1 zt:data-[state=below]:flex-col"
      >
        <div data-part="editor" className="zt:min-h-0 zt:min-w-0 zt:flex-1">
          {children}
        </div>
        {preview && <Panel side="preview" below={below} {...preview} />}
      </div>
      {panels.fields && <FieldsPopoverPanel {...panels.fields} />}
      {panels.fields && <FieldsStatusRegion />}
      <SizeStatus
        labels={{
          fields: panels.fields?.label ?? "",
          preview: panels.preview?.label ?? "",
        }}
      />
    </div>
  );
}

const rightToLeft = (element: Element) =>
  element.ownerDocument.defaultView?.getComputedStyle(element).direction ===
  "rtl";

function useSizing(
  handle: PanelHandle,
  {
    outward,
    property,
  }: {
    readonly outward: (handle: Element) => number;
    readonly property: string;
  },
  region: RefObject<HTMLElement | null>,
) {
  const { model, registry } = useWorkbenchEditor();
  const panelsUpdate = useAtomSet(model.panels);
  const sizing: HandleSizing = PANEL_HANDLES[handle];
  const update = (change: (panels: WorkbenchPanels) => WorkbenchPanels) => {
    registry.set(model.sizedFromMenu, null);
    panelsUpdate(change);
  };
  const viewSize = () => registry.get(model.viewSize);
  const bounds = () => ({ size: viewSize(), defaults: model.panelDefaults });
  const keys = (element: Element) =>
    sizing.axis === "vertical"
      ? { grow: "ArrowUp", shrink: "ArrowDown" }
      : outward(element) > 0
        ? { grow: "ArrowRight", shrink: "ArrowLeft" }
        : { grow: "ArrowLeft", shrink: "ArrowRight" };
  const moved = (element: Element, from: PointerEvent, to: PointerEvent) =>
    sizing.axis === "vertical"
      ? from.clientY - to.clientY
      : outward(element) * (to.clientX - from.clientX);
  const drag = useRef<{ from: PointerEvent; size: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragged = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    return start
      ? start.size +
          sizing.fromPixels(
            moved(event.currentTarget, start.from, event),
            viewSize(),
          )
      : null;
  };
  const end = (event: PointerEvent<HTMLDivElement>) => {
    const next = dragged(event);
    drag.current = null;
    setDragging(false);
    if (next !== null) update(sizing.write(next, viewSize()));
  };
  return {
    "data-dragging": dragging ? "" : undefined,
    onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
      const { grow, shrink } = keys(event.currentTarget);
      const move: PanelMove | null =
        event.key === grow
          ? "grow"
          : event.key === shrink
            ? "shrink"
            : event.key === "Home"
              ? "min"
              : event.key === "End"
                ? "max"
                : null;
      if (move === null) return;
      event.preventDefault();
      update(
        resizePanel(handle, move, {
          ...bounds(),
          step: event.shiftKey ? "wide" : "key",
        }),
      );
    },
    onPointerDown(event: PointerEvent<HTMLDivElement>) {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = {
        from: event,
        size: sizing.drawn(registry.get(model.panels), viewSize()),
      };
      setDragging(true);
    },
    onPointerMove(event: PointerEvent<HTMLDivElement>) {
      const next = dragged(event);
      if (next === null) return;
      const size = viewSize();
      const panels = sizing.write(next, size)(registry.get(model.panels));
      region.current?.style.setProperty(
        property,
        `${sizing.pixels(panels, size)}px`,
      );
    },
    onPointerUp: end,
    onPointerCancel: end,
    onDoubleClick() {
      update(resizePanel(handle, "reset", bounds()));
    },
  };
}

function Panel({
  side,
  below,
  label,
  labelledBy,
  resizeLabel,
  content,
  id: givenId,
  onLeave,
}: {
  side: PanelSide;
  below: boolean;
  labelledBy?: string;
  id?: string;
  onLeave?: () => void;
} & SidePanel) {
  const model = useWorkbenchModel();
  const size = useAtomValue(model.viewSize);
  const panels = useAtomValue(model.panels);
  const uniqueId = useUniqueId();
  const id = givenId ?? uniqueId;
  const name = useContainerName(label);
  const region = useRef<HTMLElement>(null);
  const edge = useRef<HTMLDivElement>(null);
  const leave = useRef(onLeave);
  useLayoutEffect(() => {
    leave.current = onLeave;
  });
  useLayoutEffect(() => {
    const parts = [region.current, edge.current];
    return () => {
      const focused = parts[0]?.ownerDocument.activeElement;
      if (focused && parts.some((part) => part?.contains(focused)))
        leave.current?.();
    };
  }, []);
  const { edge: standsAt } = PANEL_SIDES[side];
  const handle: PanelHandle = below ? "split" : side;
  const sizing = PANEL_HANDLES[handle];
  const vertical = sizing.axis === "vertical";
  const property = vertical ? "--zt-panel-height" : "--zt-panel-width";
  const handlers = useSizing(
    handle,
    {
      outward: (element) =>
        (standsAt === "leading" ? 1 : -1) * (rightToLeft(element) ? -1 : 1),
      property,
    },
    region,
  );
  const sizeText = useSizeText();
  const separator = (
    <div
      ref={edge}
      role="separator"
      tabIndex={0}
      aria-label={resizeLabel}
      aria-controls={id}
      aria-orientation={vertical ? "horizontal" : "vertical"}
      aria-valuemin={sizing.min}
      aria-valuemax={drawnMax(handle, panels, size)}
      aria-valuenow={sizing.drawn(panels, size)}
      aria-valuetext={sizeText(handle, panels, size)}
      {...handlers}
      data-part={below ? "split" : "edge"}
      data-state={below ? undefined : side}
      className={below ? panelsSplit : panelsEdge}
    />
  );
  return (
    <>
      {standsAt === "trailing" && separator}
      <section
        ref={region}
        id={id}
        role="region"
        {...(labelledBy === undefined
          ? name.attrs
          : { "aria-labelledby": labelledBy })}
        data-panel={side}
        style={{ [property]: `${sizing.pixels(panels, size)}px` }}
        data-part="panel"
        data-state={below ? "below" : side}
        className={panelsPanel}
      >
        {labelledBy === undefined && name.hiddenName}
        {content}
      </section>
      {standsAt === "leading" && separator}
    </>
  );
}

function useSizeText(): (
  handle: PanelHandle,
  panels: WorkbenchPanels,
  size: ViewSize | null,
) => string {
  const percent = new Intl.NumberFormat(runtime.getLocale(), {
    style: "percent",
  });
  return (handle, panels, size) => {
    const { unit, drawn } = PANEL_HANDLES[handle];
    const value = drawn(panels, size);
    return unit === "%"
      ? percent.format(value / 100)
      : m.workbench_panel_width_value({ width: value });
  };
}

function FieldsStatusRegion() {
  const model = useWorkbenchModel();
  const status = useAtomValue(model.fieldsStatus);
  return (
    <div role="status" data-part="status" className={panelsStatus}>
      {status && <span key={status.count}>{status.text}</span>}
    </div>
  );
}

function SizeStatus({ labels }: { labels: Record<PanelSide, string> }) {
  const model = useWorkbenchModel();
  const sized = useAtomValue(model.sizedFromMenu);
  const panels = useAtomValue(model.panels);
  const size = useAtomValue(model.viewSize);
  const sizeText = useSizeText();
  return (
    <div role="status" data-part="status" className={panelsStatus}>
      {sized &&
        m.workbench_panel_size_status({
          panel: labels[PANEL_HANDLES[sized].side],
          size: sizeText(sized, panels, size),
        })}
    </div>
  );
}
