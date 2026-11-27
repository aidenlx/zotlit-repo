import type { VirtualRows } from "#obsidian/query-view/virtual-rows.ts";
import type { HTMLAttributes, LiHTMLAttributes, ReactNode } from "react";
import {
  Fragment,
  useCallback,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

import { observeResize } from "@zotlit/obsidian-kit/observe-resize.ts";
import { cn } from "@zotlit/obsidian-kit/utils.ts";

import type { QueryView } from "./view.tsx";

import { ITEM_ROW_ATTRIBUTE, NO_ROWS } from "#core/query-view/item-rows.ts";
import {
  ListSpacer,
  TABLE_GHOST,
  TableSpacer,
  placeholderRow,
} from "#core/query-view/virtual-spacers.tsx";
import { useVirtualRows } from "#obsidian/query-view/virtual-rows.ts";

export interface WindowEntry {
  readonly key: string;
  readonly kind: string;
  readonly item: string | null;
  readonly own?: boolean;
  readonly height?: number;
}

export type Estimates = Readonly<Record<string, number>> & {
  readonly row: number;
};

type Attributes<E extends HTMLAttributes<HTMLElement>> = E & {
  readonly [data: `data-${string}`]: string | undefined;
};

export interface DrawnEntry {
  readonly props?: Attributes<LiHTMLAttributes<HTMLElement>>;
  readonly children: ReactNode;
}

interface ListFlow {
  readonly kind: "list";
  readonly as: "ul" | "ol";
  readonly props?: Attributes<HTMLAttributes<HTMLElement>>;
  readonly ghost: string;
}

interface TableFlow {
  readonly kind: "table";
  readonly props?: Attributes<HTMLAttributes<HTMLElement>>;
  readonly head: ReactNode;
  readonly columns: number;
}

interface MountedRows extends VirtualRows {
  readonly box: (el: HTMLElement | null) => void;
}

const BOX = "zt:min-h-0 zt:flex-1 zt:overflow-auto zt:[overflow-anchor:none]";

const HOLD = "zt:box-content zt:h-(--zt-virtual-size) zt:overflow-y-clip";

const OUTLINES = "zt:bg-origin-content zt:bg-clip-content";

const SURFACE =
  "zt:bg-background zt:in-[.mod-sidedock]:bg-(--background-secondary) zt:in-[.callout]:bg-[image:linear-gradient(color-mix(in_oklch,var(--callout-color)_10%,transparent),color-mix(in_oklch,var(--callout-color)_10%,transparent))]";

export function ItemsWindow({
  view,
  entries,
  estimates,
  shape,
  box,
  boxRef,
  flow,
  draw,
  drew,
}: {
  view: QueryView;
  entries: readonly WindowEntry[];
  estimates: Estimates;
  shape?: string;
  box?: Attributes<HTMLAttributes<HTMLElement>>;
  boxRef?: (el: HTMLElement | null) => void;
  flow: ListFlow | TableFlow;
  draw: (index: number) => DrawnEntry;
  drew?: () => void;
}) {
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- runs after each draw on purpose
  useLayoutEffect(() => drew?.());
  const [head, setHead] = useState<HTMLElement | null>(null);
  const [header, setHeader] = useState(0);
  useLayoutEffect(() => {
    if (!head) {
      setHeader(0);
      return;
    }
    const read = () => setHeader(head.offsetHeight);
    read();
    const observing = observeResize(head, [head], read);
    return () => observing[Symbol.dispose]();
  }, [head]);
  const {
    entries: mounted,
    after,
    measure,
    list: listRef,
    onFocus,
    learned,
    size,
    box: setBox,
  } = useItemsWindow(view, entries, { estimates, shape, sticky: header });
  const mountBox = useCallback(
    (el: HTMLDivElement | null) => {
      setBox(el);
      boxRef?.(el);
    },
    [setBox, boxRef],
  );
  const spacer = (height: number) =>
    flow.kind === "list" ? (
      <ListSpacer height={height} />
    ) : (
      <TableSpacer height={height} columns={flow.columns} />
    );
  const rows = mounted.map(({ index, before }) => {
    const { props, children } = draw(index);
    const element = {
      ...props,
      className: cn(props?.className, size !== null && SURFACE),
      ref: measure,
      "data-index": index,
    };
    return (
      <Fragment key={entries[index]!.key}>
        {before > 0 && spacer(before)}
        {flow.kind === "list" ? (
          <li {...element}>{children}</li>
        ) : (
          <tbody {...element}>{children}</tbody>
        )}
      </Fragment>
    );
  });
  const end = after > 0 && spacer(after);
  const hold = size !== null && HOLD;
  let list: ReactNode;
  if (flow.kind === "list") {
    const List = flow.as;
    list = (
      <List
        ref={listRef}
        {...flow.props}
        className={cn(flow.props?.className, hold)}
        onFocus={onFocus}
      >
        {rows}
        {end}
      </List>
    );
  } else
    list = (
      <div className={cn(hold)}>
        <table {...flow.props} onFocus={onFocus}>
          {flow.head && <thead ref={setHead}>{flow.head}</thead>}
          <tbody ref={listRef} />
          {rows}
          {end}
        </table>
      </div>
    );
  return (
    <div
      ref={mountBox}
      {...box}
      className={cn(
        BOX,
        box?.className,
        size !== null && [
          OUTLINES,
          flow.kind === "list" ? flow.ghost : TABLE_GHOST,
        ],
      )}
      style={{
        ...placeholderRow(learned.get("row") ?? estimates.row),
        ...(flow.kind === "table" && {
          "--zt-table-header-height": `${header}px`,
        }),
        ...(size !== null && {
          "--zt-virtual-size": `${flow.kind === "table" ? header + size : size}px`,
        }),
      }}
    >
      {list}
    </div>
  );
}

function useItemsWindow(
  view: QueryView,
  entries: readonly WindowEntry[],
  {
    estimates,
    shape,
    sticky,
  }: { estimates: Estimates; shape: string | undefined; sticky: number },
): MountedRows {
  const gestures = view.rows;
  const [own, setOwn] = useState<HTMLElement | null>(null);

  const { keys, places } = useMemo(() => {
    const keys: string[] = [];
    const places = new Map<string, number>();
    entries.forEach(({ item }, index) => {
      if (item === null) return;
      keys.push(item);
      if (!places.has(item)) places.set(item, index);
    });
    return { keys, places };
  }, [entries]);

  const selected = useSyncExternalStore(
    (listener) => gestures?.selection.subscribe(listener) ?? (() => {}),
    () => gestures?.selection.getState().key ?? null,
  );
  const first = gestures?.first() ?? null;
  const pinned = useMemo(
    () =>
      [selected, first].flatMap((key) =>
        key === null ? [] : [places.get(key) ?? -1],
      ),
    [selected, first, places],
  );

  const rows = useVirtualRows({
    count: entries.length,
    own,
    estimate: useCallback(
      (index: number) => {
        const entry = entries[index]!;
        return entry.height ?? estimates[entry.kind] ?? estimates.row;
      },
      [entries, estimates],
    ),
    kindOf: useCallback(
      (index: number) => {
        const entry = entries[index]!;
        return entry.own || entry.height !== undefined ? null : entry.kind;
      },
      [entries],
    ),
    keyOf: useCallback((index: number) => entries[index]!.key, [entries]),
    pinned,
    ...(shape !== undefined && { shape }),
    sticky,
    all: view.printing,
  });

  const { scrollTo } = rows;
  useLayoutEffect(() => {
    gestures?.shown({
      keys,
      scrollTo: (key) => {
        const index = places.get(key);
        if (index === undefined || scrollTo(index)) return;
        [...(own?.querySelectorAll(`[${ITEM_ROW_ATTRIBUTE}]`) ?? [])]
          .find((row) => row.getAttribute(ITEM_ROW_ATTRIBUTE) === key)
          ?.scrollIntoView({ block: "nearest" });
      },
    });
    return () => gestures?.shown(NO_ROWS);
  }, [gestures, keys, places, scrollTo, own]);

  return { ...rows, box: setOwn };
}
