import type {
  AnnotViewBody,
  EmptyStateAction,
  HeaderShape,
} from "#obsidian/annot-view/presentation.ts";
import type { IconName } from "obsidian";
import {
  Fragment,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties, RefObject } from "react";

import { IconButton } from "@zotlit/obsidian-kit/components/obsidian/icon-button.tsx";
import { Icon } from "@zotlit/obsidian-kit/components/obsidian/icon.tsx";
import { SearchInput } from "@zotlit/obsidian-kit/components/obsidian/search-input.tsx";
import { PaneState } from "@zotlit/obsidian-kit/components/pane-state.tsx";
import { cn, tooltipAttrs } from "@zotlit/obsidian-kit/utils.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { useUniqueId } from "@zotlit/ui";

import { AnnotActionsContext } from "./actions.tsx";
import { Annotation, FIELD_SHEET_SELECTOR } from "./Annotation.tsx";

import { cardPlace, moveOrigin } from "#core/annot-view/card-selection.ts";
import {
  filterAnnotations,
  isFilterActive,
} from "#obsidian/annot-view/filter.ts";
import { FilterBar } from "#obsidian/annot-view/FilterBar.tsx";
import {
  useAnnotFilter,
  useAnnotStore,
  useClearFilters,
  useSetFilterQuery,
  useToggleGroupCollapsed,
  useToggleSearchOpen,
} from "#obsidian/annot-view/model.ts";
import {
  annotViewBody,
  headerShape,
} from "#obsidian/annot-view/presentation.ts";
import { groupedCards, visibleOrder } from "#obsidian/annot-view/state.ts";
import { confineTabOrder } from "#obsidian/annot-view/tab-order.ts";

function inFieldSheet(target: EventTarget | null): boolean {
  const node = target as Node | null;
  return (
    node?.instanceOf(Element) === true &&
    node.closest(FIELD_SHEET_SELECTOR) !== null
  );
}

function useHeaderShape(): HeaderShape {
  const attachments = useAnnotStore((s) => s.attachments);
  const selectedAttachmentKey = useAnnotStore((s) => s.selectedAttachmentKey);
  const attachmentLock = useAnnotStore((s) => s.attachmentLock);
  const capability = useAnnotStore((s) => s.capability);
  const followMode = useAnnotStore((s) => s.followMode);
  const itemDisplay = useAnnotStore((s) => s.itemDisplay);
  const zoteroReaderClosed = useAnnotStore((s) => s.zoteroReaderClosed);
  return useMemo(
    () =>
      headerShape({
        attachments,
        selectedAttachmentKey,
        attachmentLock,
        capability,
        followMode,
        itemDisplay,
        zoteroReaderClosed,
      }),
    [
      attachments,
      selectedAttachmentKey,
      attachmentLock,
      capability,
      followMode,
      itemDisplay,
      zoteroReaderClosed,
    ],
  );
}

function useBody(): AnnotViewBody {
  const attachments = useAnnotStore((s) => s.attachments);
  const annotations = useAnnotStore((s) => s.annotations);
  const followMode = useAnnotStore((s) => s.followMode);
  const liveUpdatesOn = useAnnotStore((s) => s.liveUpdatesOn);
  const pinnedItemKey = useAnnotStore((s) => s.pinnedItemKey);
  const queryProblem = useAnnotStore((s) => s.queryProblem);
  return useMemo(
    () =>
      annotViewBody({
        attachments,
        annotations,
        followMode,
        liveUpdatesOn,
        pinnedItemKey,
        queryProblem,
      }),
    [
      attachments,
      annotations,
      followMode,
      liveUpdatesOn,
      pinnedItemKey,
      queryProblem,
    ],
  );
}

export function AnnotView() {
  const searchOpen = useAnnotStore((s) => s.searchOpen);
  const body = useBody();
  const [collapsed, setCollapsed] = useState(true);
  const searchBarId = useUniqueId();
  const searchButtonRef = useRef<HTMLDivElement>(null);

  const hasItem = body.kind === "list" || body.kind === "loading";
  const filterError = useAnnotStore((s) => s.filterError);
  const actions = useContext(AnnotActionsContext);
  const editingText = useAnnotStore(
    (s) => s.editing !== null && s.editing.field !== "tags",
  );
  const pressInField = useRef(false);

  return (
    <div
      className="zt:@container zt:flex zt:h-full zt:flex-col zt:overflow-hidden"
      onPointerDownCapture={(e) => {
        pressInField.current = inFieldSheet(e.target);
      }}
      onClickCapture={(e) => {
        if (!editingText || pressInField.current || inFieldSheet(e.target))
          return;
        const target = e.target as Node;
        if (
          target.instanceOf(Element) &&
          target.matches('.annots-container, [role="grid"]')
        )
          return;
        actions.onCloseEditors();
      }}
    >
      <AnnotHeader />
      {hasItem && (
        <FilterBar
          searchBarId={searchBarId}
          searchButtonRef={searchButtonRef}
          collapsed={collapsed}
          onToggleCollapsed={() => setCollapsed((c) => !c)}
        />
      )}
      {hasItem && searchOpen && (
        <SearchRow id={searchBarId} searchButtonRef={searchButtonRef} />
      )}
      {body.kind === "list" && filterError && (
        <p
          className="zt:mx-2 zt:my-1 zt:text-sm zt:text-(--text-error)"
          role="alert"
          data-annot-view-filter-error=""
        >
          {m.annot_view_filter_error()}
        </p>
      )}
      {body.kind === "list" ? (
        <AnnotList collapsed={collapsed} />
      ) : body.kind === "loading" ? (
        <div className="pane-empty zt:p-2" data-annot-view-loading="">
          {m.annot_view_loading()}
        </div>
      ) : (
        <PaneState>
          {body.kind === "problem" ? (
            <div
              className="pane-empty zt:p-2"
              role="alert"
              data-annot-view-problem=""
            >
              <p className="zt:m-0">{body.message}</p>
              {body.detail && <p className="zt:m-0 zt:mt-1">{body.detail}</p>}
            </div>
          ) : body.kind === "no-attachments" ? (
            <div className="pane-empty zt:p-2">{body.message}</div>
          ) : (
            <EmptyPane message={body.message} action={body.action} />
          )}
        </PaneState>
      )}
    </div>
  );
}

function AnnotHeader() {
  const actions = useContext(AnnotActionsContext);
  const shape = useHeaderShape();
  const labelId = useUniqueId();

  return (
    <div className="zt:flex zt:items-start zt:gap-1 zt:px-2 zt:pt-2">
      <button
        type="button"
        aria-haspopup="menu"
        aria-labelledby={labelId}
        onClick={(evt) => actions.onHeaderMenu(evt)}
        className="zt-annot-header zt:inline-flex zt:max-w-full zt:min-w-0 zt:items-center zt:gap-2 zt:rounded-sm zt:px-1.5 zt:py-1 zt:text-start zt:hover:bg-card zt:hover:ring-1 zt:hover:ring-border zt:focus-visible:bg-card zt:focus-visible:ring-2 zt:focus-visible:ring-border-focus"
      >
        <span id={labelId} className="zt:sr-only">
          {shape.label}
        </span>
        <span className="zt:flex zt:min-w-0 zt:flex-col zt:gap-0.5">
          {shape.kind === "masthead" ? (
            <Masthead shape={shape} />
          ) : (
            <StatusBar shape={shape} />
          )}
        </span>
        <ChromeIcon name="chevron-down" />
      </button>
      <div className="zt:ms-auto zt:hidden zt:shrink-0 zt:in-[.mod-sidedock]:flex">
        <IconButton
          icon="more-vertical"
          aria-haspopup="menu"
          data-annot-view-more-options=""
          onClick={(evt) => actions.onViewMenu(evt)}
          {...tooltipAttrs(m.annot_view_more_tooltip())}
        />
      </div>
    </div>
  );
}

function Masthead({
  shape,
}: {
  shape: Extract<HeaderShape, { kind: "masthead" }>;
}) {
  return (
    <>
      <span className="zt:flex zt:min-w-0 zt:items-center zt:gap-1">
        <ChromeIcon name={shape.modeIcon} />
        <span
          className="zt:min-w-0 zt:text-sm zt:font-semibold zt:text-balance"
          data-annot-header-title=""
        >
          {shape.title}
        </span>
      </span>
      {shape.byline.length > 0 && <Byline segments={shape.byline} />}
    </>
  );
}

function StatusBar({
  shape,
}: {
  shape: Extract<HeaderShape, { kind: "status-bar" }>;
}) {
  return (
    <span className="zt:flex zt:min-w-0 zt:items-center zt:gap-1">
      <ChromeIcon name={shape.modeIcon} />
      <Byline segments={[shape.modeLabel, ...shape.indicators]} />
    </span>
  );
}

function ChromeIcon({ name }: { name: IconName }) {
  return (
    <Icon
      name={name}
      size="xs"
      className="zt:shrink-0 zt:text-muted-foreground"
    />
  );
}

function Byline({ segments }: { segments: string[] }) {
  return (
    <span className="zt:min-w-0 zt:text-xs zt:text-muted-foreground zt:tabular-nums">
      {segments.map((segment, index) => (
        <span key={segment}>
          {segment}
          {index < segments.length - 1 && " · "}
        </span>
      ))}
    </span>
  );
}

function EmptyPane({
  message,
  action,
}: {
  message: string;
  action: { label: string; action: EmptyStateAction } | null;
}) {
  const actions = useContext(AnnotActionsContext);
  return (
    <div className="pane-empty zt:flex zt:flex-col zt:items-center zt:gap-4 zt:p-2">
      <div>{message}</div>
      {action && (
        <button
          onClick={() =>
            action.action === "enable-live-updates"
              ? actions.onEnableLiveUpdates()
              : actions.onPinItem()
          }
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

function SearchRow({
  id,
  searchButtonRef,
}: {
  id: string;
  searchButtonRef: RefObject<HTMLDivElement | null>;
}) {
  const filterQuery = useAnnotStore((s) => s.filterQuery);
  const setFilterQuery = useSetFilterQuery();
  const toggleSearchOpen = useToggleSearchOpen();
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useUniqueId();
  useLayoutEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div id={id} className="zt:px-2 zt:pt-1">
      <label htmlFor={inputId} className="zt:sr-only">
        {m.annot_view_search_tooltip()}
      </label>
      <SearchInput
        id={inputId}
        ref={inputRef}
        value={filterQuery}
        onChange={setFilterQuery}
        type="text"
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.stopPropagation();
          toggleSearchOpen();
          searchButtonRef.current?.focus();
        }}
        placeholder={m.annot_view_search_placeholder()}
        clearLabel={m.annot_view_clear_search()}
      />
    </div>
  );
}

export function AnnotList({
  collapsed,
  cardWidth,
}: {
  collapsed: boolean;
  cardWidth?: number;
}) {
  const actions = useContext(AnnotActionsContext);
  const annotations = useAnnotStore((s) => s.annotations);
  const groups = useAnnotStore((s) => s.groups);
  const collapsedGroups = useAnnotStore((s) => s.collapsedGroups);
  const toggleGroup = useToggleGroupCollapsed();
  const clearFilters = useClearFilters();
  const gridRef = useRef<HTMLDivElement>(null);
  const labelId = useUniqueId();
  const [scrolled, setScrolled] = useState(false);

  const filter = useAnnotFilter();
  const filtered = useMemo(
    () => (annotations ? filterAnnotations(annotations, filter) : []),
    [annotations, filter],
  );
  const tabStop = useAnnotStore((s) => {
    const visible = visibleOrder(s);
    return moveOrigin(s.cardSelection, visible) ?? visible[0] ?? null;
  });
  const tabOrder = useRef<Disposable | null>(null);
  const mountGrid = useCallback((grid: HTMLDivElement | null) => {
    gridRef.current = grid;
    tabOrder.current?.[Symbol.dispose]();
    tabOrder.current = grid ? confineTabOrder(grid) : null;
  }, []);

  if (isFilterActive(filter) && filtered.length === 0) {
    return (
      <PaneState>
        <div className="pane-empty zt:flex zt:flex-col zt:items-center zt:gap-4 zt:p-2">
          <div>{m.annot_view_filter_no_match()}</div>
          <button onClick={clearFilters}>{m.annot_view_clear_filters()}</button>
        </div>
      </PaneState>
    );
  }

  return (
    <div
      className={cn(
        "annots-container zt:@container zt:mt-1 zt:min-h-0 zt:flex-1 zt:overflow-auto zt:px-3 zt:pt-1",
        "zt:scroll-pb-8 zt:pb-11",
        "zt:scroll-pt-2 zt:before:pointer-events-none zt:before:sticky zt:before:-top-1 zt:before:z-1 zt:before:-mx-3 zt:before:-mb-2 zt:before:block zt:before:h-2",
        "zt:before:bg-linear-to-b zt:before:from-(--background-secondary) zt:before:to-transparent zt:[.mod-root_&]:before:from-(--background-primary)",
        "zt:before:opacity-0 zt:before:transition-opacity zt:data-scrolled:before:opacity-100",
      )}
      data-scrolled={scrolled ? "" : undefined}
      onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 0)}
      onClick={(e) => {
        if (e.target !== e.currentTarget && e.target !== gridRef.current)
          return;
        actions.onClearSelection();
      }}
    >
      <span id={labelId} className="zt:sr-only">
        {m.annot_view_name()}
      </span>
      <div
        ref={mountGrid}
        className={cn(
          "zt:grid zt:items-start zt:gap-3",
          cardWidth === undefined
            ? "zt:grid-cols-1 zt:@2xl:grid-cols-2 zt:@5xl:grid-cols-3"
            : "zt:grid-cols-[repeat(auto-fill,minmax(min(100%,var(--zt-card-width)),1fr))]",
        )}
        style={
          cardWidth === undefined
            ? undefined
            : ({ "--zt-card-width": `${cardWidth}px` } as CSSProperties)
        }
        data-card-width={cardWidth}
        role="grid"
        aria-multiselectable="true"
        aria-labelledby={labelId}
      >
        {groups === null
          ? filtered.map((annot) => (
              <Annotation
                key={annot.key}
                annot={annot}
                place={cardPlace(annot.key, null)}
                collapsed={collapsed}
                tabStop={cardPlace(annot.key, null) === tabStop}
              />
            ))
          : groupedCards(groups, filtered).map(({ annot, group, opens }) => {
              const folded = collapsedGroups.has(group.key);
              const place = cardPlace(annot.key, group.key);
              return (
                <Fragment key={place}>
                  {opens && (
                    <GroupHeading
                      key="group-heading"
                      label={group.label}
                      groupKey={group.key}
                      expanded={!folded}
                      onToggle={() => toggleGroup(group.key)}
                    />
                  )}
                  {!folded && (
                    <Annotation
                      key={annot.key}
                      annot={annot}
                      place={place}
                      collapsed={collapsed}
                      tabStop={place === tabStop}
                    />
                  )}
                </Fragment>
              );
            })}
      </div>
    </div>
  );
}

function GroupHeading({
  label,
  groupKey,
  expanded,
  onToggle,
}: {
  label: string;
  groupKey: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      role="row"
      data-query-group={groupKey}
      data-collapsed={expanded ? undefined : ""}
      className="zt:group/heading zt:col-span-full zt:not-first:mt-1 zt:not-first:border-t-(length:--border-width) zt:not-first:border-border zt:not-first:pt-2"
    >
      <span role="rowheader" className="zt:flex zt:min-w-0">
        <button
          type="button"
          aria-expanded={expanded}
          className="clickable-icon zt:-ms-(--size-2-3) zt:flex zt:min-w-0 zt:items-center zt:gap-1"
          onClick={onToggle}
        >
          <Icon
            name={expanded ? "chevron-down" : "chevron-right"}
            size="xs"
            className="zt:shrink-0 zt:text-(--collapse-icon-color) zt:group-data-collapsed/heading:text-(--collapse-icon-color-collapsed)"
          />
          <span className="zt:truncate zt:text-sm zt:font-(weight:--font-semibold) zt:text-foreground">
            {label}
          </span>
        </button>
      </span>
    </div>
  );
}
