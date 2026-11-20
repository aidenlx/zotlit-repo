import type { ReaderEvents } from "#/core/types.ts";

type Listener = (event: never) => void;

export class Emitter {
  readonly #listeners = new Map<keyof ReaderEvents, Set<Listener>>();
  readonly #report: (error: unknown, event: keyof ReaderEvents) => void;
  #closed = false;

  constructor(report: (error: unknown, event: keyof ReaderEvents) => void) {
    this.#report = report;
  }

  on<K extends keyof ReaderEvents>(
    event: K,
    listener: ReaderEvents[K],
  ): () => void {
    if (this.#closed) return () => {};
    let listeners = this.#listeners.get(event);
    if (!listeners) {
      listeners = new Set();
      this.#listeners.set(event, listeners);
    }
    const entry = listener as Listener;
    listeners.add(entry);
    return () => {
      listeners.delete(entry);
    };
  }

  emit<K extends keyof ReaderEvents>(
    event: K,
    payload: Parameters<ReaderEvents[K]>[0],
  ): void {
    if (this.#closed) return;
    for (const listener of this.#listeners.get(event) ?? []) {
      try {
        (listener as (event: typeof payload) => void)(payload);
      } catch (error) {
        this.#report(error, event);
      }
    }
  }

  close(): void {
    this.#closed = true;
    this.#listeners.clear();
  }
}
