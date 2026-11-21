import { useAtom, useAtomSet, useAtomValue } from "@effect/atom-react";
import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode, RefObject } from "react";

import { iconButton } from "@zotlit/obsidian-kit/components/obsidian/icon-button.tsx";
import { Icon } from "@zotlit/obsidian-kit/components/obsidian/icon.tsx";
import { cn, tooltipAttrs } from "@zotlit/obsidian-kit/utils.ts";
// The Fields Panel, the chosen Item's fields in the host's non-modal Fields
// popover, or docked beside the editor while the reader has it pinned.
import * as m from "@zotlit/plugin-messages/messages.ts";
import { useUniqueId } from "@zotlit/ui";
import { composing } from "@zotlit/ui";

import { useWorkbenchEditor, useWorkbenchModel } from "./editor.tsx";
import { useOptionalHost } from "./host.tsx";
import { pressFieldsPin } from "./model.ts";
import type { FieldsPlacement } from "./panel-layout.ts";

const fieldsPanelPanel = cn(
  "zt:flex zt:h-full zt:min-w-0 zt:flex-col zt:text-foreground",
  "zt:data-[state=popover]:w-80 zt:data-[state=popover]:max-w-full zt:data-[state=popover]:rounded-(--radius-m) zt:data-[state=popover]:border zt:data-[state=popover]:border-border zt:data-[state=popover]:bg-(--background-secondary) zt:data-[state=popover]:shadow-(--shadow-l) zt:data-[state=popover]:[--zt-pane-ground:var(--background-secondary)]",
  "zt:data-[state=popover]:transition-[translate,opacity] zt:data-[state=popover]:duration-150 zt:data-[state=popover]:ease-out zt:motion-reduce:transition-none zt:data-[state=popover]:starting:translate-x-2 zt:data-[state=popover]:starting:opacity-0",
);
// Pinned, the pin wears Obsidian's active icon (`theme.css`); with no
// room to dock, it steps back and keeps its focus and its tooltip.
const fieldsPanelPin = iconButton({
  className:
    "zt:shrink-0 zt:aria-disabled:cursor-not-allowed zt:aria-disabled:opacity-50",
});

/** What the Fields Panel holds, and what names it. */
interface FieldsPanelContent {
  /** The panel's title, which also names it to a screen reader. */
  readonly label: string;
  /** The fields: the host's field tree and its search. */
  readonly content: ReactNode;
  /**
   * The host's own pane actions, such as a More options menu, drawn in the
   * header before the pin; a host without any leaves it out.
   */
  readonly actions?: ReactNode;
}

/** The id of the docked Fields Panel, beside the Fields popover's `popoverId`. */
export const fieldsDockId = (popoverId: string) => `${popoverId}-docked`;

/**
 * The Fields action's ARIA state: a disclosure of the Fields popover
 * `popoverId` names, or of the docked panel, which it controls while either
 * stands.
 */
export function fieldsActionAttributes(
  placement: FieldsPlacement,
  popoverId: string,
): {
  readonly "aria-haspopup": "dialog" | undefined;
  readonly "aria-expanded": "true" | "false";
  readonly "aria-controls": string | undefined;
} {
  return {
    "aria-haspopup": placement === "docked" ? undefined : "dialog",
    "aria-expanded": placement === "closed" ? "false" : "true",
    "aria-controls":
      placement === "docked"
        ? fieldsDockId(popoverId)
        : placement === "popover"
          ? popoverId
          : undefined,
  };
}

/**
 * What the field rows share with the Fields Panel they stand in: the step
 * Escape takes inside the panel before the Fields popover closes, which
 * answers `true` when it took the key.
 */
export interface FieldsPanelRows {
  readonly escape: RefObject<() => boolean>;
  /** The panel, which a field's details popover stands beside. */
  readonly panel: RefObject<HTMLElement | null>;
  /**
   * The place in the panel's header for the rows' own actions, such as
   * collapsing every section, once the header is drawn.
   */
  readonly actions: HTMLElement | null;
}

const FieldsPanelRowsContext = createContext<FieldsPanelRows | null>(null);

/**
 * The Fields Panel the field rows stand in, or `null` outside one, as in the
 * standalone Template Data Explorer, whose rows keep no details.
 */
export function useFieldsPanelRows(): FieldsPanelRows | null {
  return useContext(FieldsPanelRowsContext);
}

/** The Fields Panel in the host's Fields popover. */
export function FieldsPopoverPanel(props: FieldsPanelContent) {
  const model = useWorkbenchModel();
  const host = useOptionalHost();
  const [state, setState] = useAtom(model.fieldsPanel);
  const { fields } = useAtomValue(model.placement);
  const titleId = useUniqueId();
  const escape = useRef<() => boolean>(() => false);
  const Popover = host?.fieldsAction?.popover;
  if (!Popover) return null;
  return (
    <Popover
      open={fields === "popover"}
      onClose={() => setState("closed")}
      labelledBy={titleId}
      returnFocus={state !== "to-editor"}
      onEscape={() => escape.current()}
    >
      <FieldsPanelBody
        {...props}
        titleId={titleId}
        placement="popover"
        escape={escape}
      />
    </Popover>
  );
}

/**
 * The Fields Panel docked beside the editor, whose title `titleId` names its
 * region. It takes focus in its search as it draws only after the reader
 * pinned or showed it.
 */
export function DockedFieldsPanel(
  props: FieldsPanelContent & { readonly titleId: string },
) {
  const escape = useRef<() => boolean>(() => false);
  return <FieldsPanelBody {...props} placement="docked" escape={escape} />;
}

/**
 * The panel's header and fields. The popover mounts it as it opens, and it
 * moves focus into its search field as it mounts; the docked panel does so
 * only where the reader asked for it.
 */
function FieldsPanelBody({
  label,
  content,
  titleId,
  placement,
  escape,
  actions: hostActions,
}: FieldsPanelContent & {
  readonly titleId: string;
  readonly placement: "popover" | "docked";
  readonly escape: RefObject<() => boolean>;
}) {
  const { model, registry } = useWorkbenchEditor();
  const setState = useAtomSet(model.fieldsPanel);
  const { pinned, canPin } = useAtomValue(model.fieldsPin);
  const panel = useRef<HTMLDivElement>(null);
  const [actions, setActions] = useState<HTMLElement | null>(null);
  const rows = useMemo<FieldsPanelRows>(
    () => ({ escape, panel, actions }),
    [escape, actions],
  );
  const closeLabel = m.workbench_fields_close();
  const closeTooltip = tooltipAttrs(closeLabel);
  const pinLabel = !canPin
    ? m.workbench_fields_pin_unavailable()
    : pinned
      ? m.workbench_fields_unpin()
      : m.workbench_fields_pin();
  const pinTooltip = tooltipAttrs(pinLabel);
  useLayoutEffect(() => {
    if (placement === "docked") {
      if (!registry.get(model.fieldsFocus)) return;
      registry.set(model.fieldsFocus, false);
    }
    // A panel with no search yet, as before an item is chosen, takes focus
    // on its pin, so the focus the popover held does not fall to the page.
    (
      panel.current?.querySelector<HTMLElement>("[data-part=body] input") ??
      panel.current?.querySelector<HTMLElement>("[data-part=pin]")
    )?.focus({ preventScroll: true });
  }, [placement, registry, model]);
  return (
    // Escape closes a field's details, then clears the search, before the
    // host closes the panel. A host that takes the key first asks the same
    // step through `onEscape`, and a key it took arrives here handled.
    <div
      ref={panel}
      data-part="panel"
      data-state={placement}
      className={fieldsPanelPanel}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        // Escape that drops an input method's candidate is the method's.
        if (composing(event)) return;
        if (!escape.current()) return;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <div
        data-part="header"
        className="zt:flex zt:shrink-0 zt:items-center zt:gap-1 zt:px-(--size-4-2) zt:pt-(--size-4-2)"
      >
        <span
          aria-hidden="true"
          data-part="icon"
          className="zt:flex zt:shrink-0 zt:ps-1 zt:text-(--icon-color) zt:[&_svg]:size-(--icon-s)"
        >
          <Icon name="braces" />
        </span>
        {/* A title, not a heading: the popover takes its name from it, and
            a host's heading style would outweigh the theme's part. */}
        <span
          id={titleId}
          data-part="title"
          className="zt:min-w-0 zt:flex-1 zt:truncate zt:px-1 zt:text-sm zt:font-semibold"
        >
          {label}
        </span>
        <span ref={setActions} data-part="actions" className="zt:contents" />
        {hostActions}
        {/* Disabled by aria-disabled, so the pin keeps its focus and its
            tooltip says why it does not work. */}
        <button
          type="button"
          aria-disabled={canPin ? undefined : true}
          onClick={() => pressFieldsPin(registry, model)}
          {...pinTooltip}
          data-part="pin"
          data-state={pinned && canPin ? "pinned" : undefined}
          className={fieldsPanelPin}
        >
          <Icon name={pinned && canPin ? "pin-off" : "pin"} />
        </button>
        {placement === "popover" && (
          <button
            type="button"
            onClick={() => setState("closed")}
            {...closeTooltip}
            data-part="close"
            className={iconButton({ className: "zt:shrink-0" })}
          >
            <Icon name="x" />
          </button>
        )}
      </div>
      {pinned && !canPin && (
        <p
          data-part="note"
          className="zt:shrink-0 zt:px-(--size-4-3) zt:pt-(--size-2-1) zt:text-xs zt:text-muted-foreground"
        >
          {m.workbench_fields_pinned_narrow()}
        </p>
      )}
      <FieldsPanelRowsContext.Provider value={rows}>
        <div
          data-part="body"
          className="zt:flex zt:min-h-0 zt:flex-1 zt:flex-col zt:overflow-auto"
        >
          {content}
        </div>
      </FieldsPanelRowsContext.Provider>
    </div>
  );
}
