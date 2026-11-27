import type { SuggestModal } from "obsidian";
import { Scope } from "obsidian";

export function takeEnter(modal: SuggestModal<unknown>): void {
  modal.scope = new Scope(modal.scope);
  modal.scope.register([], "Enter", (evt) => {
    if (evt.isComposing) return;
    modal.selectActiveSuggestion(evt);
    return false;
  });
}

export class CurrentAnswer<T> {
  readonly #rowsEl: HTMLElement;
  #latest: Promise<readonly T[] | null> = Promise.resolve(null);
  #pending = false;
  #closes = 0;

  constructor(rowsEl: HTMLElement) {
    this.#rowsEl = rowsEl;
  }

  track<A extends readonly T[] | null>(answer: A | Promise<A>): A | Promise<A> {
    if (!(answer instanceof Promise)) {
      this.#latest = Promise.resolve(answer);
      this.#setPending(false);
      return answer;
    }
    const shown: Promise<A> = answer.finally(() => {
      if (this.#latest === shown) this.#setPending(false);
    });
    this.#latest = shown;
    this.#setPending(true);
    return shown;
  }

  get answersTypedQuery(): boolean {
    return !this.#pending;
  }

  choose(
    value: T,
    evt: MouseEvent | KeyboardEvent,
    select: (value: T) => void,
  ): void {
    if (this.answersTypedQuery) select(value);
    else if (evt.type === "keydown") this.chooseFirst(select);
  }

  chooseFirst(select: (value: T) => void): void {
    void this.#chooseOnAnswer(select);
  }

  close(): void {
    this.#closes++;
    this.#latest = Promise.resolve(null);
    this.#setPending(false);
  }

  async #chooseOnAnswer(select: (value: T) => void): Promise<void> {
    const closes = this.#closes;
    let rows: readonly T[] | null;
    for (let answer = this.#latest; ; answer = this.#latest) {
      try {
        rows = await answer;
      } catch {
        rows = null;
      }
      if (closes !== this.#closes) return;
      if (answer === this.#latest) break;
    }
    const first = rows?.[0];
    if (first !== undefined) select(first);
  }

  #setPending(pending: boolean): void {
    this.#pending = pending;
    if (pending) this.#rowsEl.setAttribute("aria-busy", "true");
    else this.#rowsEl.removeAttribute("aria-busy");
  }
}
