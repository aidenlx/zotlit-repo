import type { CitationLookupRequest } from "@zotlit/zotero-reads/contract/citation-lookup.ts";

import type { CitationLookupObservation } from "./lookup-service.ts";

export class EditorLookup implements Disposable {
  readonly #observation;
  #generation = 0;
  #disposed = false;

  constructor(
    observe: (changed: () => void) => CitationLookupObservation,
    changed: () => void,
  ) {
    this.#observation = observe(() => {
      if (!this.#disposed) changed();
    });
  }

  get current(): CitationLookupObservation["current"] {
    return this.#observation.current;
  }

  set(request: CitationLookupRequest): void {
    const generation = ++this.#generation;
    queueMicrotask(() => {
      if (this.#disposed || generation !== this.#generation) return;
      this.#observation.set(request);
    });
  }

  [Symbol.dispose](): void {
    this.#disposed = true;
    this.#generation += 1;
    this.#observation[Symbol.dispose]();
  }
}
