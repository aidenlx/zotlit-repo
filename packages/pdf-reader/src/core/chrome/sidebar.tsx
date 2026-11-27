/** @jsxImportSource preact */
import type { OutlineNode } from "#/core/chrome/model.ts";
import { useAtomValue } from "@effect/atom-react";
import type { JSX } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

import { Icon } from "./controls.tsx";

import { pageText, useChrome } from "#/core/chrome/model.ts";
import { MIN_SIDEBAR_WIDTH } from "#/core/persist/settings.ts";
import { scrollNearest } from "#/core/subpath/apply.ts";

function Thumbnail(props: {
  readonly pageIndex: number;
  readonly label: string;
  readonly current: boolean;
  readonly ratio: number;
  readonly root: HTMLElement | null;
}): JSX.Element {
  const { host, actions, pageTheme } = useChrome();
  const theme = useAtomValue(pageTheme);
  const item = useRef<HTMLAnchorElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [painted, setPainted] = useState(false);
  useEffect(() => {
    const element = item.current;
    const target = canvas.current;
    const View = element?.ownerDocument.defaultView?.IntersectionObserver;
    if (!element || !target || !View) return;
    const lifetime = new AbortController();
    const observer = new View(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        actions
          .renderThumbnail(props.pageIndex, target, {
            signal: lifetime.signal,
            theme,
          })
          .then(
            () => {
              if (!lifetime.signal.aborted) setPainted(true);
            },
            () => {},
          );
      },
      { root: props.root },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
      lifetime.abort();
    };
  }, [actions, props.pageIndex, props.root, theme]);
  const current = props.current;
  useEffect(() => {
    if (current && item.current && props.root) {
      scrollNearest(props.root, item.current);
    }
  }, [current, props.root]);
  const page = props.pageIndex + 1;
  return (
    <a
      ref={item}
      href={`#page=${page}`}
      data-zpr-control=""
      data-zpr-part="thumbnail"
      data-page-number={page}
      data-current={props.current ? "" : undefined}
      aria-label={host.t("pdf_reader_page", { page: props.label })}
      aria-current={props.current ? "page" : undefined}
      className="zpr:group zpr:flex zpr:flex-col zpr:items-center zpr:gap-1 zpr:py-2 zpr:text-xs zpr:text-muted zpr:no-underline zpr:data-current:text-foreground zpr:focus-visible:outline-2 zpr:focus-visible:outline-accent"
      onClick={(event) => {
        event.preventDefault();
        actions.goToPage(props.pageIndex);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        actions.showMenu(
          { kind: "thumbnail", pageIndex: props.pageIndex },
          event,
        );
      }}
    >
      <canvas
        ref={canvas}
        data-painted={painted ? "" : undefined}
        style={{ "--zpr-thumbnail-ratio": String(props.ratio) }}
        className="zpr:aspect-(--zpr-thumbnail-ratio) zpr:w-(--zpr-thumbnail-width) zpr:rounded-sm zpr:border zpr:border-dashed zpr:border-border zpr:bg-page zpr:data-painted:aspect-auto zpr:data-painted:border-solid zpr:data-painted:shadow-thumbnail zpr:group-hover:border-accent zpr:group-data-current:border-2 zpr:group-data-current:border-accent"
      />
      <span>{props.label}</span>
    </a>
  );
}

function Thumbnails(): JSX.Element | null {
  const { state, labels, document } = useChrome();
  const { pageCount, pageIndex, showPageLabels } = useAtomValue(state);
  const pageLabels = useAtomValue(labels);
  const current = useAtomValue(document);
  const list = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = useState(612 / 792);
  const [root, setRoot] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => setRoot(list.current), []);
  useEffect(() => {
    if (!current) return;
    let live = true;
    void current.page(0).then((page) => {
      if (!live || !page) return;
      const viewport = page.getViewport({ scale: 1 });
      setRatio(viewport.width / viewport.height);
    });
    return () => {
      live = false;
    };
  }, [current]);
  if (!current) return null;
  return (
    <div
      ref={list}
      data-zpr-part="thumbnails"
      className="zpr:flex zpr:min-h-0 zpr:flex-1 zpr:flex-col zpr:items-center zpr:overflow-y-auto zpr:p-2"
    >
      {Array.from({ length: pageCount }, (_, index) => (
        <Thumbnail
          key={`${current.key}:${index}`}
          pageIndex={index}
          label={pageText(pageLabels, showPageLabels, index)}
          current={index === pageIndex}
          ratio={ratio}
          root={root}
        />
      ))}
    </div>
  );
}

interface OutlineEntry {
  readonly node: OutlineNode;
  readonly path: string;
}

function OutlineItem(props: {
  readonly node: OutlineNode;
  readonly path: string;
  readonly active: string | null;
  readonly expanded: ReadonlySet<string>;
  readonly onToggle: (path: string) => void;
  readonly onActivate: (path: string) => void;
}): JSX.Element {
  const { host, actions, labels, state } = useChrome();
  const pageLabels = useAtomValue(labels);
  const { showPageLabels } = useAtomValue(state);
  const { node, path } = props;
  const [pageIndex, setPageIndex] = useState<number | null>(null);
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!node.dest) return;
    let live = true;
    void actions.pageOf(node.dest).then((index) => {
      if (live) setPageIndex(index);
    });
    return () => {
      live = false;
    };
  }, [actions, node.dest]);
  const active = props.active === path;
  useEffect(() => {
    const element = row.current;
    const list = element?.closest<HTMLElement>("[data-zpr-part='outline']");
    if (active && element && list) scrollNearest(list, element);
  }, [active]);
  const open = props.expanded.has(path);
  const children = node.items.length > 0;
  const press = () => {
    props.onActivate(path);
    if (node.url) actions.openUrl(node.url);
    else if (node.action) actions.runAction(node.action);
    else if (node.dest) actions.goToDestination(node.dest);
    else if (children) props.onToggle(path);
  };
  return (
    <li>
      <div
        ref={row}
        data-zpr-part="outline-item"
        data-active={active ? "" : undefined}
        className="zpr:flex zpr:items-center zpr:gap-1 zpr:rounded-sm zpr:px-1 zpr:py-0.5 zpr:text-sm zpr:text-muted zpr:hover:bg-hover zpr:hover:text-foreground zpr:data-active:bg-active zpr:data-active:text-foreground"
        onContextMenu={(event) => {
          event.preventDefault();
          if (!node.dest) return;
          const at = event;
          void actions.sectionSubpath(node.dest).then((subpath) => {
            if (subpath) {
              actions.showMenu(
                { kind: "outline", title: node.title, subpath },
                at,
              );
            }
          });
        }}
      >
        <span className="zpr:w-4 zpr:shrink-0">
          {children && (
            <button
              type="button"
              data-zpr-control=""
              aria-expanded={open}
              aria-label={host.t(
                open
                  ? "pdf_reader_collapse_section"
                  : "pdf_reader_expand_section",
              )}
              className="zpr:flex zpr:items-center zpr:rounded-icon zpr:text-icon zpr:cursor-(--cursor,default) zpr:hover:text-icon-hover"
              onClick={() => props.onToggle(path)}
            >
              <Icon
                name={open ? "lucide-chevron-down" : "lucide-chevron-right"}
              />
            </button>
          )}
        </span>
        <button
          type="button"
          data-zpr-control=""
          data-bold={node.bold ? "" : undefined}
          data-italic={node.italic ? "" : undefined}
          className="zpr:min-w-0 zpr:flex-1 zpr:truncate zpr:text-left zpr:cursor-(--cursor,default) zpr:data-bold:font-bold zpr:data-italic:italic"
          onClick={press}
        >
          {node.title}
        </button>
        {pageIndex !== null && (
          <span className="zpr:shrink-0 zpr:text-xs zpr:text-faint">
            {pageText(pageLabels, showPageLabels, pageIndex)}
          </span>
        )}
      </div>
      {children && open && (
        <ul className="zpr:ps-4">
          {node.items.map((child, index) => (
            <OutlineItem
              key={`${path}.${index}`}
              {...props}
              node={child}
              path={`${path}.${index}`}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function flatten(nodes: readonly OutlineNode[], prefix = ""): OutlineEntry[] {
  return nodes.flatMap((node, index) => {
    const path = prefix ? `${prefix}.${index}` : String(index);
    return [{ node, path }, ...flatten(node.items, path)];
  });
}

function parents(path: string): string[] {
  const parts = path.split(".");
  return parts
    .slice(0, -1)
    .map((_, index) => parts.slice(0, index + 1).join("."));
}

function Outline(): JSX.Element | null {
  const { actions, outline, reveal, state, registry } = useChrome();
  const nodes = useAtomValue(outline);
  const revealed = useAtomValue(reveal);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    if (!revealed || !nodes) return;
    let live = true;
    const { pageIndex } = registry.get(state);
    const entries = flatten(nodes).filter((entry) => entry.node.dest);
    void Promise.all(
      entries.map((entry) => actions.pageOf(entry.node.dest!)),
    ).then((pages) => {
      if (!live) return;
      let best: string | null = null;
      for (let page = pageIndex; page >= 0 && best === null; page--) {
        const index = pages.indexOf(page);
        if (index >= 0) best = entries[index]!.path;
      }
      if (best !== null) {
        setExpanded((before) => new Set([...before, ...parents(best)]));
        setActive(best);
      }
      registry.set(reveal, false);
    });
    return () => {
      live = false;
    };
  }, [actions, nodes, registry, reveal, revealed, state]);
  if (!nodes) return null;
  return (
    <ul
      data-zpr-part="outline"
      className="zpr:min-h-0 zpr:flex-1 zpr:overflow-y-auto zpr:p-2"
    >
      {nodes.map((node, index) => (
        <OutlineItem
          key={String(index)}
          node={node}
          path={String(index)}
          active={active}
          expanded={expanded}
          onActivate={setActive}
          onToggle={(path) =>
            setExpanded((before) => {
              const next = new Set(before);
              if (!next.delete(path)) next.add(path);
              return next;
            })
          }
        />
      ))}
    </ul>
  );
}

const RESIZE_STEP = 16;

function contentOf(element: Element): HTMLElement | null {
  return element.closest<HTMLElement>("[data-zpr-part='content']");
}

function clampWidth(container: HTMLElement, width: number): number {
  const maximum = Math.max(MIN_SIDEBAR_WIDTH, container.clientWidth / 2);
  return Math.round(Math.min(maximum, Math.max(MIN_SIDEBAR_WIDTH, width)));
}

function Resizer(props: {
  readonly width: number;
  readonly onDrag: (width: number | null) => void;
}): JSX.Element {
  const { host, actions } = useChrome();
  const [maximum, setMaximum] = useState<number | undefined>(undefined);
  const start = (event: PointerEvent) => {
    const handle = event.currentTarget as HTMLElement;
    const container = contentOf(handle);
    if (!container) return;
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    const left = container.getBoundingClientRect().left;
    let width: number | null = null;
    const move = (moved: PointerEvent) => {
      width = clampWidth(container, moved.clientX - left);
      props.onDrag(width);
    };
    const end = () => {
      if (width !== null) actions.set({ sidebar: { width } });
      props.onDrag(null);
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  };
  const key = (event: KeyboardEvent) => {
    const handle = event.currentTarget as HTMLElement;
    const container = contentOf(handle);
    if (!container) return;
    const [grow, shrink] =
      getComputedStyle(handle).direction === "rtl"
        ? ["ArrowLeft", "ArrowRight"]
        : ["ArrowRight", "ArrowLeft"];
    let width: number;
    if (event.key === grow) width = props.width + RESIZE_STEP;
    else if (event.key === shrink) width = props.width - RESIZE_STEP;
    else if (event.key === "Home") width = MIN_SIDEBAR_WIDTH;
    else if (event.key === "End") width = Number.POSITIVE_INFINITY;
    else return;
    event.preventDefault();
    event.stopPropagation();
    setMaximum(clampWidth(container, Number.POSITIVE_INFINITY));
    actions.set({ sidebar: { width: clampWidth(container, width) } });
  };
  return (
    <div
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label={host.t("pdf_reader_resize_sidebar")}
      aria-valuenow={props.width}
      aria-valuemin={MIN_SIDEBAR_WIDTH}
      aria-valuemax={maximum}
      data-zpr-part="sidebar-resizer"
      className="zpr:absolute zpr:inset-y-0 zpr:-end-1 zpr:w-2 zpr:cursor-col-resize zpr:focus-visible:outline-2 zpr:focus-visible:outline-accent"
      onPointerDown={start}
      onFocus={(event) => {
        const container = contentOf(event.currentTarget);
        if (container) {
          setMaximum(clampWidth(container, Number.POSITIVE_INFINITY));
        }
      }}
      onKeyDown={key}
    />
  );
}

export function Sidebar(): JSX.Element {
  const { state, kind } = useChrome();
  const { sidebar } = useAtomValue(state);
  const [dragged, setDragged] = useState<number | null>(null);
  const width = dragged ?? sidebar.width;
  const resizable = kind === "view";
  return (
    <div
      data-zpr-part="sidebar"
      data-open={sidebar.open ? "" : undefined}
      data-panel={sidebar.panel}
      hidden={!sidebar.open}
      style={{ "--zpr-sidebar-width": `${width}px` }}
      className="zpr:relative zpr:flex zpr:w-(--zpr-sidebar-width) zpr:max-w-1/2 zpr:shrink-0 zpr:flex-col zpr:border-e zpr:border-border zpr:bg-sidebar zpr:text-foreground"
    >
      {sidebar.open && sidebar.panel === "thumbnails" && <Thumbnails />}
      {sidebar.open && sidebar.panel === "outline" && <Outline />}
      {sidebar.open && resizable && (
        <Resizer width={width} onDrag={setDragged} />
      )}
    </div>
  );
}
