import { useMemo, useRef, useState } from "react";

import type {
  ChooserGroup,
  ChooserRow,
} from "@zotlit/obsidian-kit/components/chooser-logic.ts";
import {
  Chooser,
  chooserIconButton,
  useChooserOpenPage,
  useChooserPage,
} from "@zotlit/obsidian-kit/components/chooser.tsx";
import { Icon } from "@zotlit/obsidian-kit/components/obsidian/icon.tsx";
import type { PinnedPopoverHandle } from "@zotlit/obsidian-kit/components/pinned-popover.tsx";
import { cn, tooltipAttrs } from "@zotlit/obsidian-kit/utils.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import { ConfigureViewFields, viewActions } from "./configure-view.tsx";
import { layoutOf, layoutsFor } from "./layouts.ts";
import { useQueryViewState } from "./model.ts";
import type { QueryView } from "./view.tsx";

import {
  ToolbarButtonContent,
  toolbarButtonClass,
} from "#obsidian/query-view/toolbar-button.tsx";

const VIEW_ROW_DRAG_TYPE = "application/x-zotlit-query-view";

const ADD_ROW = "action:add";

export function ViewMenu({ view }: { view: QueryView }) {
  return view.can.views ? (
    <ViewSwitch view={view} />
  ) : (
    <LayoutSwitch view={view} />
  );
}

function ViewSwitch({ view }: { view: QueryView }) {
  const file = useQueryViewState(view, (s) => s.file);
  const current = useQueryViewState(view, (s) => s.view);
  const popup = useRef<PinnedPopoverHandle>(null);

  const views = useMemo(() => file?.views ?? [], [file]);
  const currentIndex = current ? views.indexOf(current) : -1;

  if (!file || views.length === 0) return null;
  return (
    <Chooser
      value={currentIndex === -1 ? [] : [String(currentIndex)]}
      onValueChange={(next) => {
        const picked = next.find((value) => value !== String(currentIndex));
        const name = picked === undefined ? undefined : views[Number(picked)];
        if (name) view.pickView(name.name);
        popup.current?.hide();
      }}
    >
      <ViewMenuTrigger view={view} />
      <Chooser.Popup
        handle={popup}
        className="zt:[max-height:min(--spacing(120),calc(100vh_-_--spacing(2)))]"
        data-query-view-list=""
      >
        <Chooser.Input
          placeholder={m.query_view_search_views()}
          clearLabel={m.query_view_clear_search()}
        />
        <ViewList view={view} />
        <Chooser.Page>
          {(name) => <ConfigureViewPage view={view} name={name} />}
        </Chooser.Page>
      </Chooser.Popup>
    </Chooser>
  );
}

function LayoutSwitch({ view }: { view: QueryView }) {
  const file = useQueryViewState(view, (s) => s.file);
  const current = useQueryViewState(view, (s) => s.view);
  const popup = useRef<PinnedPopoverHandle>(null);
  const offered = view.layouts;
  const layouts = useMemo(
    () => (current ? layoutsFor(current, offered) : []),
    [current, offered],
  );
  const groups = useMemo<ChooserGroup<ChooserRow>[]>(
    () => [
      {
        items: layouts.map((layout) => ({
          value: layout.type,
          label: layout.name(),
        })),
      },
    ],
    [layouts],
  );
  if (!file || !current || layouts.length <= 1) return null;
  const index = file.views.indexOf(current);
  const shown = layoutOf(current);
  return (
    <Chooser
      value={[current.type]}
      onValueChange={(next) => {
        const picked = next.find((type) => type !== current.type);
        if (picked !== undefined) view.document.setViewLayout(index, picked);
        popup.current?.hide();
      }}
    >
      <Chooser.Trigger
        className={cn(toolbarButtonClass, "zt:shrink zt:text-foreground")}
        aria-label={m.query_view_layout()}
        data-query-view-menu=""
      >
        <ToolbarButtonContent
          icon={shown?.icon}
          label={shown?.name() ?? current.type}
          keepLabel
          chevron
        />
      </Chooser.Trigger>
      <Chooser.Popup handle={popup} data-query-view-list="">
        <Chooser.List groups={groups} label={m.query_view_layout()}>
          {(row) => (
            <Chooser.Item
              key={row.value}
              value={row.value}
              icon={
                layoutsFor(current).find((layout) => layout.type === row.value)
                  ?.icon
              }
              className="zt:data-selected:[font-weight:var(--font-medium)]"
              data-query-view-layout-option={row.value}
            >
              {row.label}
            </Chooser.Item>
          )}
        </Chooser.List>
      </Chooser.Popup>
    </Chooser>
  );
}

function ViewMenuTrigger({ view }: { view: QueryView }) {
  const file = useQueryViewState(view, (s) => s.file);
  const current = useQueryViewState(view, (s) => s.view);
  const openPage = useChooserOpenPage();
  const shown = current ?? file?.views[0];
  if (!shown) return null;
  return (
    <Chooser.Trigger
      className={cn(toolbarButtonClass, "zt:shrink zt:text-foreground")}
      aria-label={m.query_view_views()}
      data-query-view-menu=""
      onContextMenu={(event) => {
        if (!current) return;
        event.preventDefault();
        openPage(current.name);
      }}
    >
      <ToolbarButtonContent
        icon={layoutOf(shown)?.icon}
        label={shown.name}
        keepLabel
        chevron
      />
    </Chooser.Trigger>
  );
}

function ViewList({ view }: { view: QueryView }) {
  const file = useQueryViewState(view, (s) => s.file);
  const { openPage } = useChooserPage();
  const views = useMemo(() => file?.views ?? [], [file]);
  const groups = useMemo<ChooserGroup<ChooserRow>[]>(
    () => [
      {
        items: views.map((candidate, index) => ({
          value: String(index),
          label: candidate.name,
          next: () => openPage(candidate.name),
        })),
      },
      {
        pinned: true,
        items: [
          {
            value: ADD_ROW,
            label: m.query_view_add_view(),
            action: () => {
              view.document.addView();
              const added = view.state.getState();
              if (added.file && added.view) openPage(added.view.name);
            },
          },
        ],
      },
    ],
    [views, view, openPage],
  );

  return (
    <Chooser.List
      groups={groups}
      label={m.query_view_views()}
      emptyLabel={m.query_view_no_views_match()}
    >
      {(row) => {
        if (row.action)
          return (
            <Chooser.Action
              key={row.value}
              value={row.value}
              icon="plus"
              data-query-view-action={row.value.slice("action:".length)}
            >
              {row.label}
            </Chooser.Action>
          );
        const index = Number(row.value);
        return (
          <Chooser.Item
            key={row.value}
            value={row.value}
            icon={layoutOf(views[index]!)?.icon ?? "table"}
            className="zt:data-selected:[font-weight:var(--font-medium)]"
            end={
              <button
                type="button"
                tabIndex={-1}
                className={cn(
                  chooserIconButton,
                  "zt:-m-(--size-2-2) zt:ms-auto",
                )}
                data-query-view-configure={row.label}
                {...tooltipAttrs(m.query_view_configure_view())}
                onClick={(event) => {
                  event.stopPropagation();
                  openPage(row.label);
                }}
              >
                <Icon name="chevron-right" size="s" />
              </button>
            }
            data-query-view-row={row.label}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData(VIEW_ROW_DRAG_TYPE, row.value);
              event.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(event) => {
              if (event.dataTransfer.types.includes(VIEW_ROW_DRAG_TYPE))
                event.preventDefault();
            }}
            onDrop={(event) => {
              const from = event.dataTransfer.getData(VIEW_ROW_DRAG_TYPE);
              if (from === "") return;
              event.preventDefault();
              view.document.moveView(Number(from), index);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              openPage(row.label);
            }}
          >
            {row.label}
          </Chooser.Item>
        );
      }}
    </Chooser.List>
  );
}

function ConfigureViewPage({ view, name }: { view: QueryView; name: string }) {
  const { back, replacePage } = useChooserPage();
  const [current, setCurrent] = useState(name);
  const file = useQueryViewState(view, (s) => s.file);
  const index =
    file?.views.findIndex((candidate) => candidate.name === current) ?? -1;
  if (file && index < 0) return <Chooser.PageGone />;
  return (
    <>
      <Chooser.PageHeader
        title={m.query_view_configure_view()}
        backLabel={m.query_view_back()}
        closeLabel={m.query_view_close()}
        actions={
          <Chooser.PageMenu
            label={m.query_view_more_options()}
            items={viewActions({
              view,
              index,
              after: { duplicated: replacePage, deleted: back },
            })}
          />
        }
      />
      <Chooser.PageForm data-query-configure-view={current}>
        <ConfigureViewFields
          view={view}
          name={current}
          onRenamed={setCurrent}
        />
      </Chooser.PageForm>
    </>
  );
}
