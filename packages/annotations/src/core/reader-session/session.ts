import { createNanoEvents } from "@zotlit/shared/nanoevents";

export type ReaderSource = "zotero" | "obsidian-pdf";

export interface ReaderSessionTarget {
  attachmentKey: string;
  itemKey: string | null;
}

export interface ReaderSessionEvents {
  "target-changed": (target: ReaderSessionTarget | null) => void;
  "selection-changed": (selected: readonly string[]) => void;
}

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
  readonly #emitter = createNanoEvents<ReaderSessionEvents>();
  #target: ReaderSessionTarget | null = null;
  #selected: readonly string[] = [];
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
    return this.#selected;
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
    return this.#emitter.on(event, cb);
  }

  setTarget(target: ReaderSessionTarget | null): void {
    if (sameTarget(this.#target, target)) return;
    this.#target = target;
    if (this.#selected.length > 0) this.reportSelection([]);
    this.#emitter.emit("target-changed", target);
  }

  reportSelection(selected: readonly string[]): void {
    if (sameKeys(this.#selected, selected)) return;
    this.#selected = [...selected];
    this.#emitter.emit("selection-changed", this.#selected);
  }

  [Symbol.dispose](): void {
    this.#emitter.events = {};
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
