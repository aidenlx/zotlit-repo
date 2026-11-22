import { useEffect, useRef, useState } from "react";
import type { DragEvent, KeyboardEvent } from "react";

import { pathStartsWith, samePath } from "./row-path.ts";
import type { RowPath } from "./row-path.ts";

const DRAG_TYPE = "application/x-zotlit-reorder";

interface DropTarget {
  group: RowPath;
  before: number;
}

function moveIndex(from: RowPath, target: DropTarget): number | null {
  const at = from.at(-1)!;
  if (!samePath(from.slice(0, -1), target.group)) return target.before;
  if (target.before === at || target.before === at + 1) return null;
  return target.before > at ? target.before - 1 : target.before;
}

function lowerHalf(event: DragEvent<HTMLElement>): boolean {
  const rect = event.currentTarget.getBoundingClientRect();
  return event.clientY > rect.top + rect.height / 2;
}

const pathKey = (path: RowPath) => path.join(".");

export interface ReorderDestination {
  group: RowPath;
  index: number;
}

export function useReorder({
  disabled,
  onMove,
}: {
  disabled: boolean;
  onMove: (from: RowPath, to: ReorderDestination) => boolean;
}) {
  const [dragging, setDraggingState] = useState<RowPath | null>(null);
  const [over, setOverState] = useState<DropTarget | null>(null);
  const draggingRef = useRef<RowPath | null>(null);
  const overRef = useRef<DropTarget | null>(null);
  const focusNext = useRef<{ list: Element; path: string } | null>(null);
  useEffect(() => {
    const next = focusNext.current;
    if (!next) return;
    focusNext.current = null;
    next.list
      .querySelector<HTMLElement>(`[data-reorder-handle="${next.path}"]`)
      ?.focus();
  });
  function setOver(next: DropTarget | null) {
    const current = overRef.current;
    if (
      current === next ||
      (current &&
        next &&
        current.before === next.before &&
        samePath(current.group, next.group))
    )
      return;
    overRef.current = next;
    setOverState(next);
  }
  const shown =
    dragging && over && moveIndex(dragging, over) !== null ? over : null;
  function end() {
    draggingRef.current = null;
    setDraggingState(null);
    setOver(null);
  }
  function move(from: RowPath, target: DropTarget): boolean {
    const index = moveIndex(from, target);
    if (index === null) return false;
    return onMove(from, { group: target.group, index });
  }
  function target(place: (event: DragEvent<HTMLElement>) => DropTarget | null) {
    return (event: DragEvent<HTMLElement>) => {
      const from = draggingRef.current;
      if (!from) return;
      event.stopPropagation();
      const next = place(event);
      if (next === null || pathStartsWith(next.group, from)) {
        setOver(null);
        return;
      }
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      setOver(next);
    };
  }
  return {
    list: {
      "data-reorder-list": "",
      onDrop: (event: DragEvent<HTMLElement>) => {
        const from = draggingRef.current;
        if (!from) return;
        event.preventDefault();
        if (overRef.current) move(from, overRef.current);
        end();
      },
      onDragLeave: (event: DragEvent<HTMLElement>) => {
        const into = (event.relatedTarget ??
          event.currentTarget.ownerDocument.elementFromPoint(
            event.clientX,
            event.clientY,
          )) as Node | null;
        if (!into?.instanceOf(Node) || !event.currentTarget.contains(into))
          setOver(null);
      },
    },
    handle: (path: RowPath, count: number) => ({
      draggable: !disabled,
      role: "button" as const,
      tabIndex: disabled ? -1 : 0,
      "aria-disabled": disabled || undefined,
      "data-reorder-handle": pathKey(path),
      onDragStart: (event: DragEvent<HTMLElement>) => {
        if (disabled) return;
        event.stopPropagation();
        event.dataTransfer?.setData(DRAG_TYPE, pathKey(path));
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = "move";
          const row =
            event.currentTarget.closest<HTMLElement>("[data-reorder-row]");
          if (row) {
            const rect = row.getBoundingClientRect();
            const transform = row.style.transform;
            // oxlint-disable-next-line obsidianmd/no-static-styles-assignment -- the layer is set and cleared within one drag start, which a stylesheet class cannot time.
            row.style.transform = "translateZ(0)";
            event.dataTransfer.setDragImage?.(
              row,
              event.clientX - rect.left,
              event.clientY - rect.top,
            );
            row.win.setTimeout(() => {
              row.style.transform = transform;
            });
          }
        }
        draggingRef.current = path;
        event.currentTarget.win.setTimeout(() => {
          if (draggingRef.current === path) setDraggingState(path);
        });
      },
      onDragEnd: end,
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
        if (disabled || !event.altKey) return;
        const step =
          event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
        const at = path.at(-1)!;
        if (step === 0 || at + step < 0 || at + step >= count) return;
        event.preventDefault();
        const group = path.slice(0, -1);
        const list = event.currentTarget.closest("[data-reorder-list]");
        if (move(path, { group, before: step > 0 ? at + 2 : at - 1 }) && list)
          focusNext.current = { list, path: pathKey([...group, at + step]) };
      },
    }),
    row: (path: RowPath, count: number) => {
      const group = path.slice(0, -1);
      const at = path.at(-1)!;
      return {
        "data-reorder-row": "",
        "data-dragging": dragging && samePath(dragging, path) ? "" : undefined,
        "data-drop":
          shown && samePath(shown.group, group)
            ? shown.before === at
              ? "before"
              : shown.before === count && at === count - 1
                ? "after"
                : undefined
            : undefined,
        onDragOver: target((event) => ({
          group,
          before: lowerHalf(event) ? at + 1 : at,
        })),
      };
    },
    header: (path: RowPath) => ({
      onDragOver: target(() =>
        path.length === 0
          ? { group: path, before: 0 }
          : { group: path.slice(0, -1), before: path.at(-1)! },
      ),
    }),
    group: (path: RowPath, count: number) => ({
      "data-drop":
        shown && count === 0 && samePath(shown.group, path)
          ? "into"
          : undefined,
      onDragOver: target(() => ({ group: path, before: count })),
    }),
    rows: (path: RowPath) => ({
      onDragOver: target(() =>
        overRef.current && samePath(overRef.current.group, path)
          ? overRef.current
          : null,
      ),
    }),
  };
}

export type Reorder = ReturnType<typeof useReorder>;

export function indexAfterMove(at: number, from: number, to: number): number {
  if (at === from) return to;
  if (from < at && at <= to) return at - 1;
  if (to <= at && at < from) return at + 1;
  return at;
}

export function useListReorder({
  disabled,
  onMove,
}: {
  disabled: boolean;
  onMove: (from: number, to: number) => boolean;
}) {
  const reorder = useReorder({
    disabled,
    onMove: (from, { index }) => onMove(from.at(-1)!, index),
  });
  return {
    list: { ...reorder.list, ...reorder.rows([]) },
    row: (index: number, count: number) => reorder.row([index], count),
    handle: (index: number, count: number) => reorder.handle([index], count),
  };
}
