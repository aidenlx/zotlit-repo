import type { PageChangeCause } from "#/core/types.ts";

interface Anchor {
  readonly cause: PageChangeCause;
  readonly top: number;
  readonly left: number;
}

export class Motion {
  readonly #container: HTMLElement;
  #active: PageChangeCause | null = null;
  #anchor: Anchor | null = null;

  constructor(container: HTMLElement) {
    this.#container = container;
  }

  run<A>(cause: PageChangeCause, move: () => A): A {
    if (this.#active !== null) return move();
    this.#active = cause;
    try {
      return move();
    } finally {
      this.#active = null;
      this.#anchor = {
        cause,
        top: this.#container.scrollTop,
        left: this.#container.scrollLeft,
      };
    }
  }

  cause(): PageChangeCause {
    if (this.#active !== null) return this.#active;
    const anchor = this.#anchor;
    if (
      anchor &&
      Math.abs(this.#container.scrollTop - anchor.top) < 1 &&
      Math.abs(this.#container.scrollLeft - anchor.left) < 1
    ) {
      return anchor.cause;
    }
    this.#anchor = null;
    return "user";
  }
}
