import type { Range, VirtualItem } from "@tanstack/react-virtual";
import { useVirtualizer } from "@tanstack/react-virtual";
import { defaultRangeExtractor } from "@tanstack/react-virtual";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

import { observeResize } from "@zotlit/obsidian-kit/observe-resize.ts";

const VIRTUAL_MIN_ENTRIES = 100;

const OVERSCAN = 8;

export interface MountedEntry {
  readonly index: number;
  readonly before: number;
}

export interface VirtualRows {
  readonly entries: readonly MountedEntry[];
  readonly after: number;
  readonly measure: (el: Element | null) => void;
  readonly list: (el: HTMLElement | null) => void;
  readonly scrollTo: (index: number) => boolean;
  readonly onFocus: (event: { target: EventTarget }) => void;
  readonly learned: ReadonlyMap<string, number>;
  readonly size: number | null;
}

export function flow(
  items: readonly { index: number; start: number; end: number }[],
  start: number,
  end: number,
): { entries: MountedEntry[]; after: number } {
  const entries: MountedEntry[] = [];
  let at = start;
  for (const item of items) {
    entries.push({ index: item.index, before: Math.max(0, item.start - at) });
    at = item.end;
  }
  return { entries, after: Math.max(0, end - at) };
}

export function withPinned(range: Range, pinned: readonly number[]): number[] {
  const indexes = new Set(defaultRangeExtractor(range));
  for (const index of pinned)
    if (index >= 0 && index < range.count) indexes.add(index);
  return [...indexes].toSorted((a, b) => a - b);
}

const LEARN_SAMPLES = 5;

export function learn(
  measured: readonly { kind: string; size: number }[],
): Map<string, number> {
  const sizes = Map.groupBy(measured, ({ kind }) => kind);
  const heights = new Map<string, number>();
  for (const [kind, entries] of sizes) {
    if (entries.length < LEARN_SAMPLES) continue;
    const sorted = entries.map(({ size }) => size).toSorted((a, b) => a - b);
    heights.set(kind, sorted[Math.floor(sorted.length / 2)]!);
  }
  return heights;
}

function marginOf(scroller: HTMLElement, list: HTMLElement): number {
  return Math.round(
    list.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top +
      scroller.scrollTop,
  );
}

export function useVirtualRows({
  count,
  own,
  estimate,
  kindOf,
  keyOf,
  pinned,
  sticky,
  shape = "",
  all,
}: {
  count: number;
  own: HTMLElement | null;
  estimate: (index: number) => number;
  kindOf: (index: number) => string | null;
  keyOf: (index: number) => string;
  pinned: readonly number[];
  sticky: number;
  shape?: string;
  all: boolean;
}): VirtualRows {
  const [list, setList] = useState<HTMLElement | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [margin, setMargin] = useState(0);
  const [learned, setLearned] = useState<ReadonlyMap<string, number>>(
    () => new Map(),
  );
  const samples = useRef(new Map<string, Map<VirtualItem["key"], number>>());
  const enabled = !all && count > VIRTUAL_MIN_ENTRIES;
  const scroller = own;
  const [moved, setMoved] = useState(false);
  const [moves, setMoves] = useState(0);
  useLayoutEffect(
    () =>
      own?.onWindowMigrated(() => {
        setMoved(true);
        setMoves((count) => count + 1);
      }),
    [own],
  );
  useLayoutEffect(() => {
    if (moved) setMoved(false);
  }, [moved]);

  const focusedIndex = useMemo(() => {
    if (focused === null) return -1;
    for (let index = 0; index < count; index++)
      if (keyOf(index) === focused) return index;
    return -1;
  }, [focused, count, keyOf]);
  const kept = useMemo(
    () => (focusedIndex === -1 ? pinned : [...pinned, focusedIndex]),
    [pinned, focusedIndex],
  );
  const deferred = useRef(false);
  const revealing = useRef(false);
  const rangeExtractor = useCallback(
    (range: Range) => withPinned(range, kept),
    [kept],
  );

  const estimateSize = useCallback(
    (index: number) => {
      const kind = kindOf(index);
      return (kind === null ? undefined : learned.get(kind)) ?? estimate(index);
    },
    [kindOf, learned, estimate],
  );
  const virtualizer = useVirtualizer({
    count,
    enabled,
    getScrollElement: () => (moved ? null : scroller),
    estimateSize,
    getItemKey: useCallback(
      (index: number) => keyOf(index),
      // oxlint-disable-next-line react-hooks/exhaustive-deps -- a new estimate needs a new key function
      [keyOf, estimateSize],
    ),
    overscan: OVERSCAN,
    rangeExtractor,
    onChange: (v) => {
      if (!v.isScrolling) {
        revealing.current = false;
        if (deferred.current) {
          deferred.current = false;
          queueMicrotask(() => {
            for (const el of v.elementsCache.values()) v.measureElement(el);
          });
        }
      }
    },
    scrollMargin: margin,
    scrollPaddingStart: sticky,
    observeElementRect: (instance, cb) => {
      const el = instance.scrollElement;
      if (!el) return;
      const read = () => cb({ width: el.clientWidth, height: el.clientHeight });
      read();
      const observing = observeResize(el, [el], read);
      return () => observing[Symbol.dispose]();
    },
    measureElement: (el, entry, instance) => {
      const index = instance.indexFromElement(el);
      const kept =
        instance.itemSizeCache.get(instance.options.getItemKey(index)) ??
        instance.options.estimateSize(index);
      if (instance.isScrolling && !revealing.current) {
        deferred.current = true;
        return kept;
      }
      const size =
        entry?.borderBoxSize[0]?.blockSize ?? el.getBoundingClientRect().height;
      return size > 0 ? size : kept;
    },
    initialRect: { width: 0, height: (own?.win ?? activeWindow).innerHeight },
  });
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = () => false;

  useLayoutEffect(() => {
    if (!enabled || !scroller || !list) return;
    const read = () => setMargin(marginOf(scroller, list));
    read();
    const observing = observeResize(scroller, [scroller], read);
    scroller.addEventListener("scroll", read, { passive: true });
    return () => {
      observing[Symbol.dispose]();
      scroller.removeEventListener("scroll", read);
    };
  }, [enabled, scroller, list, sticky]);

  // oxlint-disable-next-line react-hooks/exhaustive-deps -- runs after each draw on purpose
  useLayoutEffect(() => {
    if (!enabled) return;
    for (const { index, key } of virtualizer.getVirtualItems()) {
      const kind = kindOf(index);
      const size = virtualizer.itemSizeCache.get(key);
      if (kind === null || !size || learned.has(kind)) continue;
      const sizes =
        samples.current.get(kind) ?? new Map<VirtualItem["key"], number>();
      sizes.set(key, size);
      samples.current.set(kind, sizes);
    }
    const next = learn(
      [...samples.current].flatMap(([kind, sizes]) =>
        [...sizes.values()].map((size) => ({ kind, size })),
      ),
    );
    if (next.size === 0) return;
    for (const kind of next.keys()) samples.current.delete(kind);
    setLearned(new Map([...learned, ...next]));
  });

  const heightsFollow = `${moves}\n${shape}`;
  const measuredShape = useRef(heightsFollow);
  useLayoutEffect(() => {
    if (measuredShape.current === heightsFollow) return;
    measuredShape.current = heightsFollow;
    samples.current.clear();
    setLearned(new Map());
    virtualizer.measure();
    for (const el of virtualizer.elementsCache.values())
      virtualizer.measureElement(el);
  }, [heightsFollow, virtualizer]);

  const onFocus = useCallback(
    (event: { target: EventTarget }) => {
      const target = event.target as Node;
      const entry = target.instanceOf(Element)
        ? target.closest<HTMLElement>("[data-index]")
        : null;
      const index = entry ? Number(entry.dataset.index) : -1;
      setFocused(index >= 0 && index < count ? keyOf(index) : null);
    },
    [count, keyOf],
  );

  const scrollTo = useCallback(
    (index: number) => {
      if (!enabled) return false;
      revealing.current = true;
      virtualizer.scrollToIndex(index, { align: "auto" });
      (own?.win ?? activeWindow).requestAnimationFrame(() => {
        if (!virtualizer.isScrolling) revealing.current = false;
      });
      return true;
    },
    [enabled, virtualizer, own],
  );

  if (!enabled) {
    const entries = Array.from({ length: count }, (_, index) => ({
      index,
      before: 0,
    }));
    return {
      entries,
      after: 0,
      measure: noMeasure,
      list: setList,
      scrollTo,
      onFocus,
      learned,
      size: null,
    };
  }
  const { entries, after } = flow(
    virtualizer.getVirtualItems(),
    margin,
    margin + virtualizer.getTotalSize(),
  );
  return {
    entries,
    after,
    measure: virtualizer.measureElement,
    list: setList,
    scrollTo,
    onFocus,
    learned,
    size: virtualizer.getTotalSize(),
  };
}

const noMeasure = () => {};
