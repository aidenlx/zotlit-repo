/** @jsxImportSource preact */
import type { MenuItem } from "#/core/host.ts";
import { useAtomValue } from "@effect/atom-react";
import type { ComponentChildren, JSX } from "preact";

import { Divider, IconButton } from "./controls.tsx";
import { PageInput } from "./page-input.tsx";

import { useChrome } from "#/core/chrome/model.ts";
import { MAX_ZOOM, MIN_ZOOM } from "#/core/state/zoom.ts";

function SidebarControls(): JSX.Element {
  const { host, actions, state, outline } = useChrome();
  const { sidebar } = useAtomValue(state);
  const items = useAtomValue(outline);
  const hasOutline = (items?.length ?? 0) > 0;
  const open = (event: MouseEvent) => {
    const showing = (panel: "thumbnails" | "outline") =>
      sidebar.open && sidebar.panel === panel;
    const menu: MenuItem[] = [
      {
        id: "thumbnails",
        section: "view",
        icon: "lucide-layout-grid",
        title: host.t("pdf_reader_thumbnails"),
        checked: showing("thumbnails"),
        run: () =>
          actions.set({
            sidebar: showing("thumbnails")
              ? { open: false }
              : { open: true, panel: "thumbnails" },
          }),
      },
      {
        id: "outline",
        section: "view",
        icon: "lucide-list",
        title: host.t("pdf_reader_outline"),
        checked: showing("outline"),
        disabled: !hasOutline,
        run: () =>
          actions.set({
            sidebar: showing("outline")
              ? { open: false }
              : { open: true, panel: "outline" },
          }),
      },
      {
        id: "reveal-in-outline",
        section: "action",
        icon: "lucide-list-start",
        title: host.t("pdf_reader_reveal_in_outline"),
        disabled: !hasOutline,
        run: () => actions.revealOutline(),
      },
    ];
    host.menu(event.currentTarget as HTMLElement, menu);
  };
  return (
    <>
      <IconButton
        icon="lucide-layout-list"
        part="sidebar-toggle"
        label={host.t("pdf_reader_toggle_sidebar")}
        active={sidebar.open}
        onClick={() => actions.set({ sidebar: { open: !sidebar.open } })}
      />
      <IconButton
        icon="lucide-chevron-down"
        part="sidebar-menu"
        label={host.t("pdf_reader_sidebar_options")}
        menu
        onClick={open}
      />
    </>
  );
}

function ZoomControls(): JSX.Element {
  const { host, actions, state } = useChrome();
  const current = useAtomValue(state);
  const open = (event: MouseEvent) => {
    const menu: MenuItem[] = [
      {
        id: "fit-width",
        section: "view",
        icon: "lucide-move-horizontal",
        title: host.t("pdf_reader_fit_width"),
        checked: current.zoom === "page-width",
        run: () => actions.set({ zoom: "page-width" }),
      },
      {
        id: "fit-height",
        section: "view",
        icon: "lucide-move-vertical",
        title: host.t("pdf_reader_fit_height"),
        checked: current.zoom === "page-height",
        run: () => actions.set({ zoom: "page-height" }),
      },
      {
        id: "spread-none",
        section: "action",
        icon: "lucide-rectangle-vertical",
        title: host.t("pdf_reader_single_page"),
        checked: current.spread === "none",
        run: () => actions.set({ spread: "none" }),
      },
      {
        id: "spread-odd",
        section: "action",
        icon: "rectangle-vertical-double",
        title: host.t("pdf_reader_two_page_odd"),
        checked: current.spread === "odd",
        run: () => actions.set({ spread: "odd" }),
      },
      {
        id: "spread-even",
        section: "action",
        icon: "rectangle-vertical-double",
        title: host.t("pdf_reader_two_page_even"),
        checked: current.spread === "even",
        run: () => actions.set({ spread: "even" }),
      },
      {
        id: "themed",
        section: "system",
        icon: "lucide-palette",
        title: host.t("pdf_reader_adapt_to_theme"),
        checked: current.themed,
        run: () => actions.set({ themed: !current.themed }),
      },
      ...(current.hasPageLabels
        ? [
            {
              id: "page-labels",
              section: "system",
              icon: "lucide-tag",
              title: host.t("pdf_reader_show_page_labels"),
              checked: current.showPageLabels,
              run: () =>
                actions.set({ showPageLabels: !current.showPageLabels }),
            } satisfies MenuItem,
          ]
        : []),
    ];
    host.menu(event.currentTarget as HTMLElement, menu);
  };
  const ready = current.status === "ready";
  return (
    <>
      <IconButton
        icon="lucide-zoom-out"
        part="zoom-out"
        label={host.t("pdf_reader_zoom_out")}
        disabled={!ready || current.scale <= MIN_ZOOM}
        onClick={() => actions.command("zoom-out")}
      />
      <Divider />
      <IconButton
        icon="lucide-zoom-in"
        part="zoom-in"
        label={host.t("pdf_reader_zoom_in")}
        disabled={!ready || current.scale >= MAX_ZOOM}
        onClick={() => actions.command("zoom-in")}
      />
      <IconButton
        icon="lucide-chevron-down"
        part="display-menu"
        label={host.t("pdf_reader_display_options")}
        menu
        onClick={open}
      />
    </>
  );
}

export function Toolbar(props: {
  readonly start: ComponentChildren;
  readonly end: ComponentChildren;
}): JSX.Element {
  const { kind } = useChrome();
  const full = kind === "view" || kind === "embed" || kind === "canvas";
  return (
    <div
      data-zpr-part="toolbar"
      className="zpr:flex zpr:min-h-(--zpr-toolbar-height) zpr:shrink-0 zpr:flex-wrap zpr:items-center zpr:gap-1 zpr:border-b zpr:border-border zpr:bg-background zpr:px-2 zpr:text-sm zpr:text-foreground"
    >
      {full && <SidebarControls />}
      {props.start}
      <span className="zpr:flex-1" />
      <ZoomControls />
      <span className="zpr:flex-1" />
      <PageInput />
      {props.end}
    </div>
  );
}
