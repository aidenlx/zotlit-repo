import type { MutationState } from "#obsidian/annotation-repository/service.ts";
import { useAtomValue } from "@effect/atom-react";
import * as Atom from "effect/reactivity/Atom";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import type { ReactNode } from "react";
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useMemo,
} from "react";

import { ViewRegistryProvider } from "@zotlit/obsidian-kit/view-atoms.ts";
import type { ViewRegistryHandle } from "@zotlit/obsidian-kit/view-atoms.ts";

import type { CaretPoint } from "./editor-sheet.ts";
import type { AnnotFilter } from "./filter.ts";
import type { AnnotState, EditingField, FollowMode } from "./state.ts";
import {
  initialAnnotState,
  isEditing,
  filterOf,
  toggledTags,
} from "./state.ts";
import type { AnnotViewState } from "./view-state.ts";
import {
  DEFAULT_FOLLOW_MODE,
  parseAnnotViewState,
  unpinnedMode,
} from "./view-state.ts";

import { IDLE } from "#obsidian/annotation-repository/write.ts";

export interface AnnotViewModel {
  readonly state: Atom.Writable<AnnotViewState>;
  readonly cards: Atom.Writable<AnnotState>;
  readonly query: Atom.Writable<string | null>;
}

export function makeAnnotViewModel(
  state: AnnotViewState = parseAnnotViewState(undefined),
): AnnotViewModel {
  const cards = Atom.make({ ...initialAnnotState(), ...state });
  const follow = Atom.writable(
    (get): AnnotViewState => {
      const { followMode, previousMode, pinnedItemKey } = get(cards);
      return { followMode, previousMode, pinnedItemKey };
    },
    (ctx, value: AnnotViewState) =>
      ctx.set(cards, { ...ctx.get(cards), ...value }),
  );
  return { state: follow, cards, query: Atom.make<string | null>(null) };
}

export function holdAnnotViewModel(
  registry: AtomRegistry.AtomRegistry,
  model: AnnotViewModel,
): () => void {
  const release = [
    registry.mount(model.cards),
    registry.mount(model.state),
    registry.mount(model.query),
  ];
  return () => {
    for (const off of release) off();
  };
}

export const setFollowMode =
  (mode: Exclude<FollowMode, "pinned">) =>
  (state: AnnotViewState): AnnotViewState =>
    state.followMode === mode
      ? state
      : {
          followMode: mode,
          previousMode: DEFAULT_FOLLOW_MODE,
          pinnedItemKey: null,
        };

export const pinItem =
  (itemKey: string) =>
  (state: AnnotViewState): AnnotViewState => ({
    followMode: "pinned",
    previousMode: unpinnedMode(state.followMode),
    pinnedItemKey: itemKey,
  });

export const pinCurrentItem =
  (pinnable: string | null) =>
  (state: AnnotViewState): AnnotViewState =>
    pinnable === null ? state : pinItem(pinnable)(state);

export const unpin = (state: AnnotViewState): AnnotViewState => ({
  followMode: unpinnedMode(state.previousMode),
  previousMode: DEFAULT_FOLLOW_MODE,
  pinnedItemKey: null,
});

export function sameAnnotViewState(
  a: AnnotViewState,
  b: AnnotViewState,
): boolean {
  return (
    a.followMode === b.followMode &&
    a.previousMode === b.previousMode &&
    a.pinnedItemKey === b.pinnedItemKey
  );
}

export interface AnnotStore extends Disposable {
  readonly registry: ViewRegistryHandle;
  readonly model: AnnotViewModel;
  hold(): void;
  getState(): AnnotState;
  setState(
    patch: Partial<AnnotState> | ((state: AnnotState) => Partial<AnnotState>),
  ): void;
  subscribe<A>(
    selector: (state: AnnotState) => A,
    listener: (next: A, previous: A) => void,
    options?: { equalityFn?: (a: A, b: A) => boolean },
  ): () => void;
}

export function createAnnotStore(
  registry: ViewRegistryHandle,
  model = makeAnnotViewModel(),
): AnnotStore {
  let release: (() => void) | null = holdAnnotViewModel(registry, model);
  return {
    registry,
    model,
    hold: () => {
      release ??= holdAnnotViewModel(registry, model);
    },
    getState: () => registry.get(model.cards),
    setState: (patch) =>
      registry.update(model.cards, (state) =>
        patchCards(typeof patch === "function" ? patch(state) : patch)(state),
      ),
    subscribe: (selector, listener, options) => {
      let previous = selector(registry.get(model.cards));
      return registry.subscribe(model.cards, (state) => {
        const next = selector(state);
        if ((options?.equalityFn ?? Object.is)(next, previous)) return;
        const last = previous;
        previous = next;
        listener(next, last);
      });
    },
    [Symbol.dispose]: () => {
      release?.();
      release = null;
    },
  };
}

export const patchCards =
  (patch: Partial<AnnotState>) =>
  (state: AnnotState): AnnotState =>
    Object.entries(patch).every(
      ([key, value]) => state[key as keyof AnnotState] === value,
    )
      ? state
      : { ...state, ...patch };

const AnnotModelContext = createContext<AnnotStore | null>(null);

export function AnnotStoreProvider({
  value,
  children,
}: {
  value: AnnotStore;
  children?: ReactNode;
}) {
  return createElement(
    ViewRegistryProvider,
    { registry: value.registry },
    createElement(AnnotModelContext.Provider, { value }, children),
  );
}

function useAnnotStoreApi(): AnnotStore {
  const model = useContext(AnnotModelContext);
  if (!model) throw new Error("Annotation cards need their leaf model");
  return model;
}

export function useAnnotStore<A>(selector: (state: AnnotState) => A): A {
  const { model } = useAnnotStoreApi();
  return useAtomValue(model.cards, selector);
}
export function useMutation(annotationKey: string): MutationState {
  return useAnnotStore((s) => s.mutations.get(annotationKey) ?? IDLE);
}

export function useEditingTarget(
  annotationKey: string,
  field: EditingField,
): { open: (caretAt?: CaretPoint) => void; close: () => void } {
  const store = useAnnotStoreApi();
  return {
    open: (caretAt) =>
      store.setState({
        editing: caretAt
          ? { annotationKey, field, caretAt }
          : { annotationKey, field },
      }),
    close: () => {
      if (isEditing(store.getState(), annotationKey, field))
        store.setState({ editing: null });
    },
  };
}

export function useToggleSearchOpen(): () => void {
  const store = useAnnotStoreApi();
  return () => {
    const { searchOpen } = store.getState();
    store.setState(
      searchOpen
        ? { searchOpen: false, filterQuery: "" }
        : { searchOpen: true },
    );
  };
}

export function useToggleGroupCollapsed(): (groupKey: string) => void {
  const store = useAnnotStoreApi();
  return (groupKey) => {
    const collapsed = new Set(store.getState().collapsedGroups);
    if (!collapsed.delete(groupKey)) collapsed.add(groupKey);
    store.setState({ collapsedGroups: collapsed });
  };
}

export function useSetFilterQuery(): (query: string) => void {
  const store = useAnnotStoreApi();
  return (query) => store.setState({ filterQuery: query });
}

export function useClearFilters(): () => void {
  const store = useAnnotStoreApi();
  return () =>
    store.setState({ filterQuery: "", selectedColors: [], selectedTags: [] });
}

export function useToggleSelectedColor(): (color: string) => void {
  const store = useAnnotStoreApi();
  return (color) => {
    const { selectedColors } = store.getState();
    store.setState({
      selectedColors: selectedColors.includes(color)
        ? selectedColors.filter((c) => c !== color)
        : [...selectedColors, color],
    });
  };
}

export function useSetSelectedColors(): (colors: string[]) => void {
  const store = useAnnotStoreApi();
  return useCallback(
    (colors) => store.setState({ selectedColors: colors }),
    [store],
  );
}

export function useAnnotFilter(): AnnotFilter {
  const filterQuery = useAnnotStore((s) => s.filterQuery);
  const selectedColors = useAnnotStore((s) => s.selectedColors);
  const selectedTags = useAnnotStore((s) => s.selectedTags);
  return useMemo(
    () => filterOf({ filterQuery, selectedColors, selectedTags }),
    [filterQuery, selectedColors, selectedTags],
  );
}

export function useToggleSelectedTag(): (tag: string) => void {
  const store = useAnnotStoreApi();
  return useCallback(
    (tag) =>
      store.setState({
        selectedTags: toggledTags(store.getState().selectedTags, tag),
      }),
    [store],
  );
}

export function useSetSelectedTags(): (tags: string[]) => void {
  const store = useAnnotStoreApi();
  return useCallback((tags) => store.setState({ selectedTags: tags }), [store]);
}

export function observeRead<A, E>(
  registry: ViewRegistryHandle,
  atom: Atom.Atom<import("effect/reactivity/AsyncResult").AsyncResult<A, E>>,
): { promise: Promise<A | null>; [Symbol.dispose](): void } {
  const pending = Promise.withResolvers<A | null>();
  let off = () => {};
  const finish = (result: A | null) => {
    off();
    pending.resolve(result);
  };
  off = registry.subscribe(atom, (result) => {
    if (!result.waiting && result._tag !== "Initial")
      finish(result._tag === "Success" ? result.value : null);
  });
  const result = registry.get(atom);
  if (!result.waiting && result._tag !== "Initial")
    finish(result._tag === "Success" ? result.value : null);
  return { promise: pending.promise, [Symbol.dispose]: () => finish(null) };
}
