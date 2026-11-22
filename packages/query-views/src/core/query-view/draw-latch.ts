export class DrawLatch<T> {
  readonly #current: () => T;
  #drawn: T | undefined = undefined;
  #waits: (() => void)[] = [];

  constructor(current: () => T) {
    this.#current = current;
  }

  drew(value: T): void {
    this.#drawn = value;
    if (value === this.#current()) this.release();
  }

  drawn(): Promise<void> {
    if (this.#drawn === this.#current()) return Promise.resolve();
    return new Promise((resolve) => this.#waits.push(resolve));
  }

  release(): void {
    const waits = this.#waits;
    this.#waits = [];
    for (const resolve of waits) resolve();
  }
}
