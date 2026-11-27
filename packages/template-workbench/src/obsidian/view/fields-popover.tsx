import type {
  WorkbenchFieldDetailsProps,
  WorkbenchFieldsAction,
  WorkbenchFieldsPopoverProps,
} from "#obsidian/workbench-ui/index.tsx";
import { Platform } from "obsidian";
import type { RefObject } from "react";
import { useLayoutEffect, useRef, useState } from "react";

import { PinnedPopover } from "@zotlit/obsidian-kit/components/pinned-popover.tsx";
import type {
  PageKey,
  PinnedPopoverHandle,
} from "@zotlit/obsidian-kit/components/pinned-popover.tsx";
import * as m from "@zotlit/plugin-messages/messages.ts";

const PANEL_KEYS: readonly PageKey[] = [{ modifiers: ["Mod"], key: "Enter" }];

let surfaces = 0;

export function fieldsActionHost(
  anchor: RefObject<HTMLElement | null>,
  view: RefObject<HTMLElement | null>,
): WorkbenchFieldsAction {
  const popoverId = `zt-fields-popover-${++surfaces}`;
  function FieldsPopover({
    open,
    onClose,
    labelledBy,
    returnFocus,
    onEscape,
    children,
  }: WorkbenchFieldsPopoverProps) {
    const handle = useRef<PinnedPopoverHandle>(null);
    const latest = useRef({ onClose, returnFocus, open });
    useLayoutEffect(() => {
      latest.current = { onClose, returnFocus, open };
    });
    const [shown, setShown] = useState(false);
    const unmounted = useRef(false);
    useLayoutEffect(
      () => () => {
        unmounted.current = true;
      },
      [],
    );
    useLayoutEffect(() => {
      if (open) {
        handle.current?.show();
        return;
      }
      if (!latest.current.returnFocus) {
        const active = anchor.current?.doc.activeElement;
        if (active?.instanceOf(HTMLElement) && handle.current?.contains(active))
          active.blur();
      }
      handle.current?.hide();
    }, [open]);
    return (
      <PinnedPopover
        anchor={anchor}
        inset={view}
        handle={handle}
        id={popoverId}
        role="dialog"
        aria-labelledby={labelledBy}
        onEscape={onEscape}
        pageKeys={PANEL_KEYS}
        onOpenChange={(next) => {
          if (unmounted.current) return;
          setShown(next);
          if (!next && latest.current.open) latest.current.onClose();
        }}
        className="zt:h-full"
      >
        {shown && children}
      </PinnedPopover>
    );
  }
  function FieldDetails(props: WorkbenchFieldDetailsProps) {
    return <FieldDetailsPopover {...props} view={view} />;
  }
  return {
    popover: FieldsPopover,
    popoverId,
    focus: () => anchor.current?.focus({ preventScroll: true }),
    details: FieldDetails,
    get insertShortcut() {
      return Platform.isMacOS
        ? m.workbench_fields_insert_key_mac()
        : m.workbench_fields_insert_key();
    },
  };
}

function FieldDetailsPopover({
  anchor,
  panel,
  onClose,
  labelledBy,
  children,
  view,
}: WorkbenchFieldDetailsProps & {
  readonly view: RefObject<HTMLElement | null>;
}) {
  const handle = useRef<PinnedPopoverHandle>(null);
  const [row] = useState(() => ({ current: anchor }));
  const [beside] = useState(() => ({ current: panel }));
  const latest = useRef(onClose);
  useLayoutEffect(() => {
    latest.current = onClose;
  });
  const unmounted = useRef(false);
  useLayoutEffect(() => {
    handle.current?.show();
    return () => {
      unmounted.current = true;
    };
  }, []);
  return (
    <PinnedPopover
      anchor={row}
      beside={beside}
      within={view}
      handle={handle}
      initialFocus={false}
      pageKeys={PANEL_KEYS}
      aria-labelledby={labelledBy}
      onOpenChange={(next) => {
        if (!next && !unmounted.current) latest.current();
      }}
    >
      {children}
    </PinnedPopover>
  );
}
