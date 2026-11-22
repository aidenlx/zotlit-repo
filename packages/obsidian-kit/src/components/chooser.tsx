import { Scope, prepareFuzzySearch } from "obsidian";
import type { IconName } from "obsidian";
import {
  Fragment,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
  Ref,
  RefObject,
} from "react";

import { themeHook } from "@zotlit/plugin-kernel/theme-hooks.ts";
import { useUniqueId } from "@zotlit/ui";
import { composing } from "@zotlit/ui";

import {
  activatedRow,
  chooserLayout,
  clampedHighlight,
  movedHighlight,
  rehomedHighlight,
} from "./chooser-logic.ts";
import type {
  ChooserActivation,
  ChooserGroup,
  ChooserMove,
  ChooserRow,
} from "./chooser-logic.ts";
import { PinnedPopover } from "./pinned-popover.tsx";
import type { PinnedPopoverHandle } from "./pinned-popover.tsx";

import { useObsidianApp } from "#app-context.ts";
import { Icon } from "#components/obsidian/icon.tsx";
import { SearchInput } from "#components/obsidian/search-input.tsx";
import { registerKeymap } from "#disposables.ts";
import { cn, tooltipAttrs } from "#utils.ts";
import "./chooser.css";

interface ChooserState {
  selected: readonly string[];
  onValueChange: (next: string[]) => void;
  open: boolean;
  setOpen: (open: boolean) => void;
  popupId: string;
  triggerRef: RefObject<HTMLButtonElement | null>;
  handleRef: RefObject<PinnedPopoverHandle | null>;
  popupRef: RefObject<HTMLDivElement | null>;
  close: () => void;
  listId: string;
  listRef: RefObject<HTMLDivElement | null>;
  firstPage: RefObject<string | null>;
  firstQuery: RefObject<string>;
  sessionPage: RefObject<((page: string) => void) | null>;
  pagesOnly: boolean;
}

const ChooserContext = createContext<ChooserState | null>(null);

function useChooser(): ChooserState {
  const state = useContext(ChooserContext);
  if (!state) throw new Error("Chooser part rendered outside a Chooser");
  return state;
}

interface ChooserSessionState {
  query: string;
  setQuery: (next: string) => void;
  publishRows: (rows: readonly ChooserRow[]) => void;
  highlightRow: (index: number) => void;
  optionId: (index: number) => string;
  active: number;
  activeOptionId: string | null;
  scope: Scope;
  activeValue: () => string | null;
  page: string | null;
  depth: number;
  openPage: (page: string) => void;
  back: () => void;
  replacePage: (page: string) => void;
}

const ChooserSessionContext = createContext<ChooserSessionState | null>(null);

function useChooserSession(): ChooserSessionState {
  const state = useContext(ChooserSessionContext);
  if (!state) throw new Error("Chooser part rendered outside a Chooser.Popup");
  return state;
}

export function useChooserQuery(): string {
  return useChooserSession().query;
}

export function useChooserScope(): Pick<
  ChooserSessionState,
  "scope" | "activeValue"
> {
  const { scope, activeValue } = useChooserSession();
  return { scope, activeValue };
}

export function useChooserPage(): Pick<
  ChooserSessionState,
  "page" | "openPage" | "back" | "replacePage"
> {
  const { page, openPage, back, replacePage } = useChooserSession();
  return { page, openPage, back, replacePage };
}

export function useChooserOpenPage(): (page: string) => void {
  const { handleRef, firstPage, sessionPage } = useChooser();
  return useCallback(
    (page: string) => {
      const open = sessionPage.current;
      if (open) return open(page);
      firstPage.current = page;
      handleRef.current?.show();
    },
    [handleRef, firstPage, sessionPage],
  );
}

export function useChooserOpenSearch(): (query: string) => void {
  const { handleRef, firstQuery, open } = useChooser();
  return useCallback(
    (query: string) => {
      if (open) return;
      firstQuery.current = query;
      handleRef.current?.show();
    },
    [handleRef, firstQuery, open],
  );
}

interface ChooserListState {
  indexOf: ReadonlyMap<string, number>;
  rows: readonly ChooserRow[];
  active: number;
  optionId: (index: number) => string;
}

const ChooserListContext = createContext<ChooserListState | null>(null);

function useChooserList(): ChooserListState {
  const state = useContext(ChooserListContext);
  if (!state) throw new Error("Chooser.Item rendered outside a Chooser.List");
  return state;
}

function runActivation(
  activation: ChooserActivation,
  close: () => void,
  emit: (next: string[]) => void,
): void {
  if (activation.kind === "action") activation.run(close);
  else if (activation.kind === "select") emit(activation.values);
}

function pageSizeOf(list: HTMLElement | null): number {
  const box = list?.querySelector<HTMLElement>("[data-chooser-scroll]") ?? list;
  const row = box?.querySelector<HTMLElement>('[role="option"]');
  if (!box || !row || row.offsetHeight === 0) return 0;
  return Math.floor(box.clientHeight / row.offsetHeight);
}

export interface ChooserProps {
  value: readonly string[];
  onValueChange: (next: string[]) => void;
  pagesOnly?: boolean;
  children: ReactNode;
}

export function Chooser({
  value,
  onValueChange,
  pagesOnly = false,
  children,
}: ChooserProps) {
  const [open, setOpen] = useState(false);
  const popupId = useUniqueId();
  const listRef = useRef<HTMLDivElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const handleRef = useRef<PinnedPopoverHandle | null>(null);
  const close = useCallback(() => handleRef.current?.hide(), []);
  const firstPage = useRef<string | null>(null);
  const firstQuery = useRef("");
  const sessionPage = useRef<((page: string) => void) | null>(null);

  const state = useMemo<ChooserState>(
    () => ({
      selected: value,
      onValueChange,
      open,
      setOpen,
      popupId,
      triggerRef,
      handleRef,
      popupRef,
      close,
      listId: `${popupId}-list`,
      listRef,
      firstPage,
      firstQuery,
      sessionPage,
      pagesOnly,
    }),
    [value, onValueChange, open, popupId, close, pagesOnly],
  );

  return <ChooserContext value={state}>{children}</ChooserContext>;
}

function ChooserSession({ children }: { children: ReactNode }) {
  const app = useObsidianApp();
  const {
    selected,
    onValueChange,
    popupId,
    popupRef,
    close,
    listRef,
    firstPage,
    firstQuery,
    sessionPage,
    pagesOnly,
  } = useChooser();
  const [query, setQueryState] = useState(() => {
    const first = firstQuery.current;
    firstQuery.current = "";
    return first;
  });
  const [pages, setPages] = useState<readonly string[]>(() => {
    const first = firstPage.current;
    firstPage.current = null;
    return first === null ? [] : [first];
  });
  const page = pages.at(-1) ?? null;
  const depth = pages.length;
  useLayoutEffect(() => {
    if (pagesOnly && depth === 0) close();
  }, [pagesOnly, depth, close]);

  const openPage = useCallback(
    (page: string) =>
      setPages((now) => (now.at(-1) === page ? now : [...now, page])),
    [],
  );
  const back = useCallback(() => setPages((now) => now.slice(0, -1)), []);
  const replacePage = useCallback(
    (page: string) => setPages((now) => [...now.slice(0, -1), page]),
    [],
  );

  const [rows, setRows] = useState<readonly ChooserRow[]>([]);
  const [highlight, setHighlight] = useState(query.length > 0 ? 0 : -1);

  const setQuery = useCallback((next: string) => {
    setQueryState(next);
    setHighlight(next.length > 0 ? 0 : -1);
  }, []);

  const latest = useRef({ rows, highlight, selected, onValueChange, page });
  latest.current = { rows, highlight, selected, onValueChange, page };

  const publishRows = useCallback((next: readonly ChooserRow[]) => {
    const { rows: previous, highlight: at } = latest.current;
    const held = previous[clampedHighlight(at, previous.length)]?.value ?? null;
    setRows(next);
    setHighlight(
      previous.length === 0 && at >= 0 ? 0 : rehomedHighlight(held, next),
    );
  }, []);

  const optionId = useCallback(
    (index: number) => `${popupId}-option-${index}`,
    [popupId],
  );
  const active = clampedHighlight(highlight, rows.length);

  const [scope] = useState(() => new Scope(app.scope));
  const activeValue = useCallback(() => {
    const { rows: shown, highlight: at } = latest.current;
    return shown[clampedHighlight(at, shown.length)]?.value ?? null;
  }, []);

  useLayoutEffect(() => {
    const move = (step: ChooserMove) => (event: KeyboardEvent) => {
      if (composing(event) || latest.current.page !== null) return;
      const { rows: shown, highlight: at } = latest.current;
      setHighlight(
        movedHighlight(at, step, {
          count: shown.length,
          pageSize: pageSizeOf(listRef.current),
        }),
      );
      return false;
    };
    const activate = (event: KeyboardEvent) => {
      if (composing(event)) return;
      if (latest.current.page !== null) return commitField();
      const {
        rows: shown,
        highlight: at,
        selected: ticked,
        onValueChange: emit,
      } = latest.current;
      const row = shown[clampedHighlight(at, shown.length)];
      runActivation(activatedRow(row, ticked), close, emit);
      return false;
    };
    const commitField = () => {
      const field = popupRef.current?.doc.activeElement;
      if (
        !field?.instanceOf(HTMLInputElement) ||
        !["text", "search"].includes(field.type) ||
        !popupRef.current?.contains(field)
      )
        return;
      field.closest<HTMLElement>("[data-chooser-page]")?.focus();
      field.form?.requestSubmit();
      return false;
    };
    const escape = (event: KeyboardEvent) => {
      if (composing(event)) return;
      if (latest.current.page === null) close();
      else back();
      return false;
    };
    const stack = new DisposableStack();
    stack.use(registerKeymap(scope, [], "ArrowUp", move("previous")));
    stack.use(registerKeymap(scope, [], "ArrowDown", move("next")));
    stack.use(registerKeymap(scope, [], "PageUp", move("page-up")));
    stack.use(registerKeymap(scope, [], "PageDown", move("page-down")));
    stack.use(registerKeymap(scope, [], "Home", move("first")));
    stack.use(registerKeymap(scope, [], "End", move("last")));
    stack.use(registerKeymap(scope, ["Ctrl"], "p", move("previous")));
    stack.use(registerKeymap(scope, ["Ctrl"], "n", move("next")));
    stack.use(registerKeymap(scope, [], "Enter", activate));
    stack.use(registerKeymap(scope, [], "Escape", escape));
    stack.use(
      registerKeymap(scope, [], "ArrowRight", (event) => {
        if (composing(event) || latest.current.page !== null) return;
        const { rows: shown, highlight: at } = latest.current;
        const next =
          at < 0 ? undefined : shown[clampedHighlight(at, shown.length)]?.next;
        if (!next) return;
        next(close);
        return false;
      }),
    );
    return () => stack.dispose();
  }, [scope, close, listRef, popupRef, back]);

  useLayoutEffect(() => {
    app.keymap.pushScope(scope);
    return () => app.keymap.popScope(scope);
  }, [app, scope]);

  useLayoutEffect(() => {
    sessionPage.current = openPage;
    return () => {
      sessionPage.current = null;
    };
  }, [sessionPage, openPage]);

  const onPage = useRef(page !== null);
  useLayoutEffect(() => {
    const was = onPage.current;
    onPage.current = page !== null;
    if (!was || page !== null) return;
    const popup = popupRef.current;
    (popup?.querySelector<HTMLElement>("input") ?? listRef.current)?.focus();
  }, [page, popupRef, listRef]);

  const session = useMemo<ChooserSessionState>(
    () => ({
      query,
      setQuery,
      publishRows,
      highlightRow: setHighlight,
      optionId,
      active,
      activeOptionId: active < 0 ? null : optionId(active),
      scope,
      activeValue,
      page,
      depth,
      openPage,
      back,
      replacePage,
    }),
    [
      query,
      setQuery,
      publishRows,
      optionId,
      active,
      scope,
      activeValue,
      page,
      depth,
      openPage,
      back,
      replacePage,
    ],
  );

  return (
    <ChooserSessionContext value={session}>{children}</ChooserSessionContext>
  );
}

export interface ChooserTriggerProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "type"
> {
  ref?: Ref<HTMLButtonElement>;
  blocked?: boolean;
}

function Trigger({
  className,
  ref,
  blocked,
  onClick,
  ...rest
}: ChooserTriggerProps) {
  const { triggerRef, handleRef, open, listId } = useChooser();
  const attach = useCallback(
    (node: HTMLButtonElement | null) => {
      triggerRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [triggerRef, ref],
  );
  return (
    <button
      ref={attach}
      type="button"
      aria-expanded={open}
      aria-controls={rest.role === "combobox" && open ? listId : undefined}
      aria-disabled={blocked || undefined}
      data-open={open ? "" : undefined}
      {...rest}
      onClick={(e) => {
        if (blocked) return;
        onClick?.(e);
        if (!e.defaultPrevented) handleRef.current?.toggle();
      }}
      className={cn(
        themeHook.chooserTrigger,
        "zt:group",
        "zt:aria-disabled:cursor-default zt:aria-disabled:opacity-50",
        className,
      )}
    />
  );
}

export interface ChooserPopupProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "id" | "popover"
> {
  handle?: Ref<PinnedPopoverHandle>;
  anchor?: RefObject<HTMLElement | null>;
}

function Popup({
  className,
  handle,
  anchor,
  children,
  ...rest
}: ChooserPopupProps) {
  const { popupId, popupRef, triggerRef, handleRef, setOpen, open, listRef } =
    useChooser();
  useImperativeHandle(
    handle,
    () => ({
      show: () => handleRef.current?.show(),
      hide: () => handleRef.current?.hide(),
      toggle: () => handleRef.current?.toggle(),
      contains: (node) => handleRef.current?.contains(node) ?? false,
    }),
    [handleRef],
  );

  useLayoutEffect(() => {
    const popup = popupRef.current;
    if (!open || !popup) return;
    if (popup.contains(popup.doc.activeElement)) return;
    const field = popup.querySelector<HTMLElement>("input");
    (field ?? listRef.current)?.focus();
  }, [open, popupRef, listRef]);

  return (
    <PinnedPopover
      ref={popupRef}
      anchor={anchor ?? triggerRef}
      handle={handleRef}
      onOpenChange={setOpen}
      id={popupId}
      {...rest}
      onKeyDown={(event) => {
        rest.onKeyDown?.(event);
        if (isUndoKey(event)) event.stopPropagation();
      }}
      className={cn(
        themeHook.chooser,
        "zt:flex zt:[max-height:min(--spacing(75),calc(100vh_-_--spacing(2)))] zt:max-w-80 zt:min-w-50 zt:flex-col",
        "zt:border-(length:--menu-border-width) zt:border-(--menu-border-color) zt:bg-(--menu-background) zt:text-foreground zt:shadow-(--menu-shadow)",
        "zt:rounded-(--menu-radius) zt:[corner-shape:var(--menu-corner-shape)]",
        className,
      )}
    >
      {open && <ChooserSession>{children}</ChooserSession>}
    </PinnedPopover>
  );
}

function isUndoKey(event: ReactKeyboardEvent): boolean {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return false;
  const key = event.key.toLowerCase();
  return key === "z" || key === "y";
}

export interface ChooserInputProps {
  placeholder: string;
  clearLabel: string;
}

function Input({ placeholder, clearLabel }: ChooserInputProps) {
  const { open, listId } = useChooser();
  const { query, setQuery, activeOptionId, page } = useChooserSession();
  if (page !== null) return null;
  return (
    <SearchInput
      type="text"
      role="combobox"
      aria-expanded={open}
      aria-controls={listId}
      aria-activedescendant={activeOptionId ?? undefined}
      className="zt:shrink-0"
      value={query}
      onChange={setQuery}
      placeholder={placeholder}
      clearLabel={clearLabel}
    />
  );
}

export interface ChooserListProps<Row extends ChooserRow> extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "children" | "aria-label" | "aria-labelledby"
> {
  label: string;
  groups: readonly ChooserGroup<Row>[];
  emptyLabel?: string;
  children: (row: Row) => ReactNode;
}

function List<Row extends ChooserRow>({
  label,
  groups,
  emptyLabel,
  children,
  className,
  ...rest
}: ChooserListProps<Row>) {
  const { listId, listRef } = useChooser();
  const { query, active, activeOptionId, optionId, publishRows, page } =
    useChooserSession();
  const { sections, rows, empty } = useMemo(
    () =>
      chooserLayout(groups, query ? prepareFuzzySearch(query) : null, query),
    [groups, query],
  );

  useLayoutEffect(() => {
    if (page === null) publishRows(rows);
  }, [rows, publishRows, page]);

  const scrolled = sections.filter((section) => !section.pinned);
  const pinned = sections.filter((section) => section.pinned);
  const drawSections = (drawn: typeof sections, footer = false) =>
    drawn.map((section, index) => (
      <Fragment key={section.groupIndex}>
        {(index > 0 || (empty && !footer)) && <Separator />}
        {section.label === undefined ? (
          section.rows.map(children)
        ) : (
          <div
            role="group"
            aria-labelledby={`${listId}-group-${section.groupIndex}`}
          >
            <div
              id={`${listId}-group-${section.groupIndex}`}
              className="zt:ps-1.5 zt:pt-1 zt:pb-0.5 zt:text-xs zt:text-muted-foreground"
            >
              {section.label}
            </div>
            {section.rows.map(children)}
          </div>
        )}
      </Fragment>
    ));

  const list = useMemo<ChooserListState>(
    () => ({
      indexOf: new Map(rows.map((row, index) => [row.value, index])),
      rows,
      active,
      optionId,
    }),
    [rows, active, optionId],
  );

  if (page !== null) return null;
  return (
    <>
      {emptyLabel !== undefined && (
        <div
          role="status"
          className={cn(
            "zt:shrink-0 zt:px-2 zt:text-xs zt:text-muted-foreground",
            empty && "zt:py-1",
          )}
        >
          {empty ? emptyLabel : ""}
        </div>
      )}
      <span id={`${listId}-label`} hidden>
        {label}
      </span>
      <div
        ref={listRef}
        id={listId}
        role="listbox"
        aria-labelledby={`${listId}-label`}
        tabIndex={-1}
        aria-multiselectable
        aria-activedescendant={activeOptionId ?? undefined}
        {...rest}
        className={cn(
          pinned.length === 0
            ? "zt:min-h-0 zt:flex-1 zt:overflow-y-auto zt:p-(--menu-padding)"
            : "zt:flex zt:min-h-0 zt:flex-1 zt:flex-col",
          className,
        )}
      >
        <ChooserListContext value={list}>
          {pinned.length === 0 ? (
            drawSections(scrolled)
          ) : (
            <>
              <div
                role="presentation"
                data-chooser-scroll=""
                className="zt:min-h-0 zt:flex-1 zt:overflow-y-auto zt:p-(--menu-padding)"
              >
                {drawSections(scrolled)}
              </div>
              <div
                role="presentation"
                data-chooser-pinned=""
                className="zt:shrink-0 zt:border-t-(length:--border-width) zt:border-border zt:p-(--size-4-1)"
              >
                {drawSections(pinned, true)}
              </div>
            </>
          )}
        </ChooserListContext>
      </div>
    </>
  );
}

function Separator() {
  return (
    <div
      role="presentation"
      aria-hidden
      className="zt:my-1 zt:h-[var(--menu-divider-width,1px)] zt:bg-[var(--menu-divider-color,var(--background-modifier-border))]"
    />
  );
}

function useRowSlot(value: string) {
  const { selected, onValueChange, close } = useChooser();
  const { highlightRow } = useChooserSession();
  const { indexOf, rows, active, optionId } = useChooserList();
  const ref = useRef<HTMLDivElement>(null);

  const index = indexOf.get(value) ?? -1;
  const row = rows[index];
  const highlighted = index >= 0 && index === active;

  useLayoutEffect(() => {
    if (highlighted) ref.current?.scrollIntoView({ block: "nearest" });
  }, [highlighted]);

  return {
    ref,
    id: index < 0 ? undefined : optionId(index),
    highlighted,
    disabled: row?.disabled ?? false,
    activate: () => {
      if (index >= 0) highlightRow(index);
      runActivation(activatedRow(row, selected), close, onValueChange);
    },
  };
}

const rowBox = (disabled: boolean, className?: string) =>
  cn(
    "zt:flex zt:cursor-clickable zt:items-center zt:gap-(--size-4-2) zt:rounded-sm zt:p-(--size-2-2) zt:ps-(--size-2-3) zt:text-sm",
    disabled ? "zt:text-muted-foreground" : "zt:hover:bg-muted",
    "zt:data-highlighted:bg-muted",
    className,
  );

interface RowShellProps extends HTMLAttributes<HTMLDivElement> {
  value: string;
  selected: boolean;
  icon?: IconName;
  leading?: ReactNode;
  end?: ReactNode;
}

function RowShell({
  value,
  selected,
  icon,
  leading,
  end,
  className,
  children,
  ...rest
}: RowShellProps) {
  const { ref, id, highlighted, disabled, activate } = useRowSlot(value);

  return (
    <div
      ref={ref}
      id={id}
      role="option"
      aria-selected={selected}
      aria-disabled={disabled || undefined}
      data-highlighted={highlighted ? "" : undefined}
      onClick={activate}
      {...rest}
      className={rowBox(disabled, className)}
    >
      {leading ?? (
        <Icon
          name={icon ?? "check"}
          size="s"
          className={cn("zt:shrink-0", !icon && "zt:invisible")}
        />
      )}
      <span className={cn("zt:truncate", end && "zt:min-w-0 zt:flex-1")}>
        {children}
      </span>
      {end}
    </div>
  );
}

export interface ChooserItemProps
  extends HTMLAttributes<HTMLDivElement>, Pick<RowShellProps, "leading"> {
  value: string;
  icon?: IconName;
  end?: ReactNode;
}

function Item({ value, icon, ...rest }: ChooserItemProps) {
  const { selected } = useChooser();
  const ticked = selected.includes(value);

  return (
    <RowShell
      value={value}
      selected={ticked}
      icon={icon ?? (ticked ? "check" : undefined)}
      data-selected={ticked ? "" : undefined}
      {...rest}
    />
  );
}

export interface ChooserActionProps
  extends HTMLAttributes<HTMLDivElement>, Pick<RowShellProps, "leading"> {
  value: string;
  icon?: IconName;
}

function Action({ value, icon, ...rest }: ChooserActionProps) {
  return <RowShell value={value} selected={false} icon={icon} {...rest} />;
}

export interface ChooserPageProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "children"
> {
  children: (page: string) => ReactNode;
}

function Page({ children, ...rest }: ChooserPageProps) {
  const { page } = useChooserSession();
  if (page === null) return null;
  return (
    <PageBody key={page} {...rest}>
      {children(page)}
    </PageBody>
  );
}

function PageBody({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const page = ref.current;
    const field = page?.querySelector<HTMLElement>(
      "input:not([type=checkbox]):not([type=range]), textarea, select",
    );
    (field ?? page)?.focus();
    if (
      field?.instanceOf(HTMLInputElement) ||
      field?.instanceOf(HTMLTextAreaElement)
    )
      field.select();
  }, []);
  return (
    <div
      ref={ref}
      tabIndex={-1}
      data-chooser-page=""
      {...rest}
      className={cn(
        "zt:flex zt:min-h-0 zt:flex-col zt:overflow-y-auto zt:outline-none",
        className,
      )}
    />
  );
}

export function useChooserPageSave(save: () => void): void {
  const latest = useRef(save);
  latest.current = save;
  useEffect(() => () => latest.current(), []);
}

export function useChooserPageText(
  initial: string,
): [text: string, setText: (next: string) => void, typed: RefObject<string>] {
  const [text, setTextState] = useState(initial);
  const typed = useRef(initial);
  const setText = useCallback((next: string) => {
    typed.current = next;
    setTextState(next);
  }, []);
  return [text, setText, typed];
}

function PageGone() {
  const { back } = useChooserSession();
  useLayoutEffect(() => back(), [back]);
  return null;
}

export const chooserIconButton =
  "zt-chooser-icon zt:flex zt:shrink-0 zt:cursor-(--cursor) zt:items-center zt:justify-center zt:rounded-(--clickable-icon-radius) zt:[corner-shape:var(--corner-shape)] zt:px-(--size-2-3) zt:py-(--size-2-2) zt:text-(--icon-color) zt:hover:bg-(--background-modifier-hover) zt:hover:text-(--icon-color-hover) zt:focus-visible:shadow-[0_0_0_var(--input-border-width-focus)_var(--background-modifier-border-focus)] zt:focus-visible:outline-none zt:[&_svg]:opacity-(--icon-opacity) zt:hover:[&_svg]:opacity-(--icon-opacity-hover)";

const PAGE_TITLE =
  "zt:flex zt:min-w-0 zt:flex-1 zt:items-center zt:gap-(--size-4-1) zt:rounded-(--radius-s) zt:p-(--size-2-2) zt:text-(length:--font-ui-small) zt:[font-weight:var(--font-medium)] zt:text-foreground";

export interface ChooserPageHeaderProps {
  title: string;
  backLabel: string;
  closeLabel: string;
  actions?: ReactNode;
}

function PageHeader({
  title,
  backLabel,
  closeLabel,
  actions,
}: ChooserPageHeaderProps) {
  const { close, pagesOnly } = useChooser();
  const { back, depth } = useChooserSession();
  return (
    <div
      data-chooser-page-header=""
      className="zt:flex zt:shrink-0 zt:items-center zt:gap-(--size-4-1) zt:p-(--size-4-1)"
    >
      {pagesOnly && depth <= 1 ? (
        <span className={PAGE_TITLE} data-chooser-page-title="">
          <span className="zt:truncate">{title}</span>
        </span>
      ) : (
        <button
          type="button"
          className={cn(
            PAGE_TITLE,
            "zt-chooser-page-back zt:cursor-(--cursor) zt:hover:bg-(--background-modifier-hover)",
          )}
          data-chooser-page-back=""
          {...tooltipAttrs(backLabel)}
          onClick={back}
        >
          <Icon
            name="chevron-left"
            size="s"
            className="zt:shrink-0 zt:text-muted-foreground"
          />
          <span className="zt:truncate">{title}</span>
        </button>
      )}
      {actions}
      <button
        type="button"
        className={chooserIconButton}
        data-chooser-page-close=""
        {...tooltipAttrs(closeLabel)}
        onClick={close}
      >
        <Icon name="x" size="s" />
      </button>
    </div>
  );
}

function PageForm({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      className={cn(
        "zt:flex zt:flex-col zt:gap-(--size-4-2) zt:px-(--size-4-2) zt:pt-(--size-4-1) zt:pb-(--size-4-2) zt:text-(length:--font-ui-small)",
        className,
      )}
    />
  );
}

export interface ChooserPageFieldProps {
  label: string;
  description?: ReactNode;
  invalid?: boolean;
  after?: ReactNode;
  inline?: boolean;
  labelId?: string;
  children: ReactNode;
}

function PageField({
  label,
  description,
  invalid,
  inline,
  labelId,
  after,
  children,
}: ChooserPageFieldProps) {
  const Field = inline ? "div" : "label";
  return (
    <Field
      className={cn(
        "zt:flex zt:gap-(--size-2-2)",
        inline ? "zt:items-center zt:justify-between" : "zt:flex-col",
      )}
    >
      <span className="zt:flex zt:min-w-0 zt:flex-col zt:gap-0.5">
        <span id={labelId} className="zt:text-foreground">
          {label}
        </span>
        {description && (
          <span
            className={cn(
              "zt:text-xs",
              invalid ? "zt:text-(--text-error)" : "zt:text-muted-foreground",
            )}
          >
            {description}
          </span>
        )}
      </span>
      {inline ? (
        children
      ) : (
        <span className="zt:flex zt:min-h-(--input-height) zt:items-center zt:*:min-w-0 zt:*:flex-1">
          {children}
        </span>
      )}
      {after}
    </Field>
  );
}

export interface ChooserPageMenuItem {
  title: string;
  icon: IconName;
  checked?: boolean;
  warning?: boolean;
  disabled?: boolean;
  hook?: string;
  onSelect: () => void;
}

export interface ChooserPageMenuProps {
  label: string;
  items: readonly ChooserPageMenuItem[];
}

function PageMenu({ label, items }: ChooserPageMenuProps) {
  const id = useUniqueId();
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<PinnedPopoverHandle>(null);
  return (
    <>
      <button
        ref={button}
        type="button"
        id={`${id}-button`}
        onClick={() => menu.current?.toggle()}
        className={chooserIconButton}
        data-chooser-page-menu=""
        {...tooltipAttrs(label)}
      >
        <Icon name="more-horizontal" size="s" />
      </button>
      <PinnedPopover
        anchor={button}
        handle={menu}
        id={id}
        role="menu"
        aria-labelledby={`${id}-button`}
        className={cn(
          "zt:flex zt:min-w-45 zt:flex-col zt:p-(--size-4-1)",
          "zt:border-(length:--menu-border-width) zt:border-(--menu-border-color) zt:bg-(--menu-background) zt:text-foreground zt:shadow-(--menu-shadow)",
          "zt:rounded-(--menu-radius) zt:[corner-shape:var(--menu-corner-shape)]",
        )}
      >
        {items.map((item, index) => (
          <Fragment key={item.title}>
            {item.warning && index > 0 && !items[index - 1]!.warning && (
              <Separator />
            )}
            <button
              type="button"
              role="menuitem"
              disabled={item.disabled}
              data-chooser-page-menu-item={item.hook}
              className={cn(
                "zt-chooser-page-menu-item",
                rowBox(item.disabled ?? false, "zt:w-full zt:text-start"),
                item.warning && !item.disabled && "zt:text-(--text-error)",
              )}
              onClick={() => {
                menu.current?.hide();
                item.onSelect();
              }}
            >
              <Icon name={item.icon} size="s" className="zt:shrink-0" />
              <span className="zt:min-w-0 zt:flex-1 zt:truncate">
                {item.title}
              </span>
              {item.checked && (
                <Icon name="check" size="s" className="zt:shrink-0" />
              )}
            </button>
          </Fragment>
        ))}
      </PinnedPopover>
    </>
  );
}

Chooser.Trigger = Trigger;
Chooser.Popup = Popup;
Chooser.Input = Input;
Chooser.List = List;
Chooser.Item = Item;
Chooser.Action = Action;
Chooser.Page = Page;
Chooser.PageHeader = PageHeader;
Chooser.PageForm = PageForm;
Chooser.PageField = PageField;
Chooser.PageGone = PageGone;
Chooser.PageMenu = PageMenu;
