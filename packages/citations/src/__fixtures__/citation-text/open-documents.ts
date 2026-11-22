import type { OpenDocuments } from "#core/citation-text/open-documents.ts";

export class OpenDocumentsStub implements OpenDocuments {
  readonly #open = new Map<string, number>();
  readonly #listeners = new Set<() => void>();

  paths(): ReadonlySet<string> {
    return new Set(this.#open.keys());
  }

  subscribe(changed: () => void): Disposable {
    this.#listeners.add(changed);
    return { [Symbol.dispose]: () => this.#listeners.delete(changed) };
  }

  open(path: string): void {
    this.#open.set(path, (this.#open.get(path) ?? 0) + 1);
    this.#notify();
  }

  close(path: string): void {
    const leaves = (this.#open.get(path) ?? 0) - 1;
    if (leaves > 0) this.#open.set(path, leaves);
    else this.#open.delete(path);
    this.#notify();
  }

  rename(from: string, to: string): void {
    const leaves = this.#open.get(from);
    if (leaves === undefined) return;
    this.#open.delete(from);
    this.#open.set(to, leaves);
    this.#notify();
  }

  #notify(): void {
    for (const listener of this.#listeners) listener();
  }
}
