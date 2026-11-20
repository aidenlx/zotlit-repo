import type { OutlineNode } from "#/core/chrome/model.ts";
import type { ReaderDocument } from "#/core/document/document.ts";
import type { PageTheme } from "#/core/theme/theme.ts";
import type { Observable, ReaderState } from "#/core/types.ts";
import * as Atom from "effect/reactivity/Atom";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";

import { scheduleBrowserTask } from "#/core/internal/scheduler.ts";
import { MIN_SIDEBAR_WIDTH } from "#/core/persist/settings.ts";
import { plainPage } from "#/core/theme/theme.ts";

export const initialReaderState: ReaderState = {
  status: "loading",
  failure: null,
  passwordRetry: false,
  pageIndex: 0,
  pageCount: 0,
  pageLabel: null,
  hasPageLabels: false,
  showPageLabels: true,
  zoom: "page-width",
  scale: 1,
  spread: "none",
  sidebar: { open: false, panel: "thumbnails", width: MIN_SIDEBAR_WIDTH },
  find: {
    open: false,
    query: "",
    caseSensitive: false,
    highlightAll: true,
    matchDiacritics: false,
    entireWord: false,
    phase: "idle",
    result: null,
  },
  themed: false,
};

export interface ReaderAtoms extends Disposable {
  readonly registry: AtomRegistry.AtomRegistry;
  readonly stateAtom: Atom.Atom<ReaderState>;
  readonly documentAtom: Atom.Atom<ReaderDocument | null>;
  readonly outlineAtom: Atom.Writable<readonly OutlineNode[] | null>;
  readonly labelsAtom: Atom.Writable<readonly string[] | null>;
  readonly revealAtom: Atom.Writable<boolean>;
  readonly pageThemeAtom: Atom.Writable<PageTheme>;
  write<A>(atom: Atom.Writable<A>, value: A): void;
  readonly state: Observable<ReaderState>;
  readonly document: Observable<ReaderDocument | null>;
  update(change: (state: ReaderState) => ReaderState): void;
  setDocument(document: ReaderDocument | null): void;
}

function observe<A>(
  registry: AtomRegistry.AtomRegistry,
  atom: Atom.Atom<A>,
  options: {
    readonly live: () => boolean;
    readonly report: (error: unknown) => void;
  },
): Observable<A> & { close(): void } {
  const { live, report } = options;
  let last = registry.get(atom);
  const listeners = new Set<(value: A, previous: A) => void>();
  const stop = registry.subscribe(atom, (value) => {
    const previous = last;
    last = value;
    if (!live()) return;
    for (const listener of listeners) {
      try {
        listener(value, previous);
      } catch (error) {
        report(error);
      }
    }
  });
  return {
    get: () => (live() ? registry.get(atom) : last),
    subscribe: (listener) => {
      if (!live()) return () => {};
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    close: () => {
      listeners.clear();
      stop();
    },
  };
}

export function makeReaderAtoms(
  report: (error: unknown, phase: string) => void,
): ReaderAtoms {
  const registry = AtomRegistry.make({ scheduleTask: scheduleBrowserTask });
  const stateAtom = Atom.make(initialReaderState);
  const documentAtom = Atom.make<ReaderDocument | null>(null);
  const outlineAtom = Atom.make<readonly OutlineNode[] | null>(null);
  const labelsAtom = Atom.make<readonly string[] | null>(null);
  const revealAtom = Atom.make(false);
  const pageThemeAtom = Atom.make<PageTheme>(plainPage);
  const held = [
    registry.mount(stateAtom),
    registry.mount(documentAtom),
    registry.mount(outlineAtom),
    registry.mount(labelsAtom),
    registry.mount(revealAtom),
    registry.mount(pageThemeAtom),
  ];
  let live = true;
  const isLive = () => live;
  const state = observe(registry, stateAtom, {
    live: isLive,
    report: (error) => report(error, "subscribe:state"),
  });
  const document = observe(registry, documentAtom, {
    live: isLive,
    report: (error) => report(error, "subscribe:document"),
  });
  return {
    registry,
    stateAtom,
    documentAtom,
    outlineAtom,
    labelsAtom,
    revealAtom,
    pageThemeAtom,
    write: (atom, value) => {
      if (live && registry.get(atom) !== value) registry.set(atom, value);
    },
    state,
    document,
    update: (change) => {
      if (!live) return;
      const current = registry.get(stateAtom);
      const next = change(current);
      if (next !== current) registry.set(stateAtom, next);
    },
    setDocument: (value) => {
      if (live && registry.get(documentAtom) !== value) {
        registry.set(documentAtom, value);
      }
    },
    [Symbol.dispose]: () => {
      if (!live) return;
      live = false;
      state.close();
      document.close();
      for (const release of held) release();
      registry.dispose();
    },
  };
}
