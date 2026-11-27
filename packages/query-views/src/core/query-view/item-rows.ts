import type { DragEvent, FocusEvent, HTMLAttributes, MouseEvent } from "react";
import { useSyncExternalStore } from "react";

type ItemSelection = { readonly key: string | null };

export interface ItemRowGestures {
  readonly selection: {
    getState(): { readonly key: string | null };
    getInitialState(): { readonly key: string | null };
    setState: {
      (
        partial:
          | ItemSelection
          | Partial<ItemSelection>
          | ((state: ItemSelection) => ItemSelection | Partial<ItemSelection>),
        replace?: false,
      ): void;
      (
        state: ItemSelection | ((state: ItemSelection) => ItemSelection),
        replace: true,
      ): void;
    };
    subscribe(
      listener: (
        state: { readonly key: string | null },
        previous: { readonly key: string | null },
      ) => void,
    ): () => void;
  };
  first(): string | null;
  // oxlint-disable-next-line obsidianmd/no-global-this -- type position: React's event type shadows the DOM name
  click(key: string, event: globalThis.MouseEvent): void;
  select(key: string): void;
  // oxlint-disable-next-line obsidianmd/no-global-this -- type position: React's event type shadows the DOM name
  open(key: string, event: globalThis.MouseEvent): void;
  // oxlint-disable-next-line obsidianmd/no-global-this -- type position: React's event type shadows the DOM name
  menu(key: string, event: globalThis.MouseEvent): void;
  drag(key: string, event: DragEvent<HTMLElement>): void;
  shown(rows: ShownRows): void;
}

export const NO_ROWS: ShownRows = { keys: [], scrollTo: () => {} };

export interface ShownRows {
  readonly keys: readonly string[];
  scrollTo(key: string): void;
}

export const ITEM_ROW_ATTRIBUTE = "data-query-item-row";

export const ITEM_ROW_REVEALED_ATTRIBUTE = "data-revealed";

function onControl(event: { target: EventTarget; currentTarget: Element }) {
  const target = event.target as Node;
  if (!target.instanceOf(Element)) return false;
  const control = target.closest("a, button");
  return control !== null && event.currentTarget.contains(control);
}

export function useItemRow(
  gestures: ItemRowGestures | undefined,
  key: string,
): HTMLAttributes<HTMLElement> & { "data-selected"?: "" } {
  const selected = useSyncExternalStore(
    (listener) => gestures?.selection.subscribe(listener) ?? (() => {}),
    () => gestures?.selection.getState().key ?? null,
  );
  if (!gestures) return {};
  const stop = selected === null ? gestures.first() === key : selected === key;
  return {
    [ITEM_ROW_ATTRIBUTE]: key,
    "data-selected": selected === key ? "" : undefined,
    "aria-current": selected === key ? "true" : undefined,
    tabIndex: stop ? 0 : -1,
    draggable: true,
    onClick: (event: MouseEvent<HTMLElement>) => {
      if (onControl(event)) gestures.select(key);
      else gestures.click(key, event.nativeEvent);
    },
    onFocus: (event: FocusEvent<HTMLElement>) => {
      if (event.target === event.currentTarget) gestures.select(key);
    },
    onDoubleClick: (event: MouseEvent<HTMLElement>) => {
      if (onControl(event)) return;
      gestures.open(key, event.nativeEvent);
    },
    onContextMenu: (event: MouseEvent<HTMLElement>) => {
      if (onControl(event)) return;
      event.preventDefault();
      gestures.menu(key, event.nativeEvent);
    },
    onDragStart: (event: DragEvent<HTMLElement>) => gestures.drag(key, event),
  } as HTMLAttributes<HTMLElement>;
}
