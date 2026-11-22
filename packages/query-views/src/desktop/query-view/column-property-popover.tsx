import { useImperativeHandle, useLayoutEffect, useRef } from "react";
import type { Ref, RefObject } from "react";

import {
  Chooser,
  useChooserOpenPage,
} from "@zotlit/obsidian-kit/components/chooser.tsx";
import type { PinnedPopoverHandle } from "@zotlit/obsidian-kit/components/pinned-popover.tsx";

import { PropertyPage } from "./property-page.tsx";
import type { ViewProperties } from "./view-properties.ts";
import type { QueryView } from "./view.tsx";

export interface ColumnPropertyHandle {
  open(anchor: HTMLElement, path: string): void;
  close(): void;
}

const NO_SELECTION: readonly string[] = [];
const noop = () => {};

export function ColumnPropertyPopover({
  view,
  properties,
  handle,
}: {
  view: QueryView;
  properties: ViewProperties;
  handle: Ref<ColumnPropertyHandle>;
}) {
  const anchor = useRef<HTMLElement | null>(null);
  const popup = useRef<PinnedPopoverHandle>(null);
  useLayoutEffect(() => {
    if (anchor.current && !anchor.current.isConnected) popup.current?.hide();
  }, [properties]);
  return (
    <Chooser value={NO_SELECTION} onValueChange={noop} pagesOnly>
      <Opener anchor={anchor} popup={popup} handle={handle} />
      <Chooser.Popup
        anchor={anchor}
        handle={popup}
        className="zt:[max-height:min(--spacing(120),calc(100vh_-_--spacing(2)))] zt:min-w-60"
        data-query-column-popover=""
      >
        <Chooser.Page>
          {(page) => {
            const entry = properties.kept(page);
            if (!entry) return <Chooser.PageGone />;
            return (
              <PropertyPage
                view={view}
                entry={entry}
                shown={properties.visible.some(({ path }) => path === page)}
                onShownChange={(show) =>
                  view.document.editView({
                    order: properties.withShown(page, show),
                  })
                }
              />
            );
          }}
        </Chooser.Page>
      </Chooser.Popup>
    </Chooser>
  );
}

function Opener({
  anchor,
  popup,
  handle,
}: {
  anchor: RefObject<HTMLElement | null>;
  popup: RefObject<PinnedPopoverHandle | null>;
  handle: Ref<ColumnPropertyHandle>;
}) {
  const openPage = useChooserOpenPage();
  useImperativeHandle(
    handle,
    () => ({
      open: (el, path) => {
        anchor.current = el;
        openPage(path);
      },
      close: () => popup.current?.hide(),
    }),
    [anchor, popup, openPage],
  );
  return null;
}
