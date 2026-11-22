import * as Atom from "effect/reactivity/Atom";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";

export type ReaderSource = "zotero" | "obsidian-pdf";

export interface ReaderSessionTarget {
  attachmentKey: string;
  itemKey: string | null;
}

interface SessionValues {
  "target-changed": ReaderSessionTarget | null;
  "selection-changed": readonly string[];
}

export type ReaderSessionEvents = {
  [K in keyof SessionValues]: (value: SessionValues[K]) => void;
};

const reported: {
  [K in keyof SessionValues]: Atom.Writable<SessionValues[K]>;
} = {
  "target-changed": Atom.keepAlive(Atom.make<ReaderSessionTarget | null>(null)),
  "selection-changed": Atom.keepAlive(Atom.make<readonly string[]>([])),
};

export interface ReaderSession {
  readonly source: ReaderSource;
  readonly target: ReaderSessionTarget | null;
  readonly selected: readonly string[];
  navigateToAnnotation(annotationKey: string): void;
  setSelectedAnnotations(annotationKeys: readonly string[]): void;
  addSelectionSurface(el: HTMLElement): () => void;
  on<K extends keyof ReaderSessionEvents>(
    event: K,
    cb: ReaderSessionEvents[K],
  ): () => void;
}

export interface ReaderSessionHostDeps {
  source: ReaderSource;
  navigate: (annotationKey: string) => void;
  select: (annotationKeys: readonly string[]) => void;
}

export class ReaderSessionHost implements ReaderSession, Disposable {
  readonly source: ReaderSource;
  readonly #navigate;
  readonly #select;
  readonly #registry = AtomRegistry.make();
  #target: ReaderSessionTarget | null = null;
  readonly #selectionSurfaces = new Set<HTMLElement>();

  constructor({ source, navigate, select }: ReaderSessionHostDeps) {
    this.source = source;
    this.#navigate = navigate;
    this.#select = select;
  }

  get target(): ReaderSessionTarget | null {
    return this.#target;
  }

  get selected(): readonly string[] {
    return this.#registry.get(reported["selection-changed"]);
  }

  navigateToAnnotation(annotationKey: string): void {
    this.#navigate(annotationKey);
  }

  setSelectedAnnotations(annotationKeys: readonly string[]): void {
    this.#select(annotationKeys);
  }

  addSelectionSurface(el: HTMLElement): () => void {
    this.#selectionSurfaces.add(el);
    return () => {
      this.#selectionSurfaces.delete(el);
    };
  }

  onSelectionSurface(node: Node | null): boolean {
    for (const el of this.#selectionSurfaces)
      if (el.contains(node)) return true;
    return false;
  }

  on<K extends keyof ReaderSessionEvents>(
    event: K,
    cb: ReaderSessionEvents[K],
  ): () => void {
    return this.#registry.subscribe(reported[event], cb);
  }

  setTarget(target: ReaderSessionTarget | null): void {
    if (sameTarget(this.#target, target)) return;
    this.#target = target;
    if (this.selected.length > 0) this.reportSelection([]);
    this.#registry.set(reported["target-changed"], target);
  }

  reportSelection(selected: readonly string[]): void {
    if (sameKeys(this.selected, selected)) return;
    this.#registry.set(reported["selection-changed"], [...selected]);
  }

  [Symbol.dispose](): void {
    const selected = this.selected;
    this.#registry.reset();
    this.#registry.set(reported["selection-changed"], selected);
    this.#registry.set(reported["target-changed"], this.#target);
    this.#selectionSurfaces.clear();
  }
}

function sameTarget(
  a: ReaderSessionTarget | null,
  b: ReaderSessionTarget | null,
): boolean {
  if (a === null || b === null) return a === b;
  return a.attachmentKey === b.attachmentKey && a.itemKey === b.itemKey;
}

function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((key, index) => key === b[index]);
}
