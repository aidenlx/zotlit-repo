export const LOADING_REVEAL_MS = 100;

export interface FirstAnswerView {
  hide(): void;
  reveal(): void;
  showLoading(): void;
  win(): Window;
}

export class FirstAnswerGate {
  readonly #view: FirstAnswerView;
  #timer: number | undefined;
  #timerWin: Window | null = null;
  #pendingOpen: object | null = null;

  constructor(view: FirstAnswerView) {
    this.#view = view;
  }

  open(): void {
    this.close();
    const pendingOpen = {};
    this.#pendingOpen = pendingOpen;
    this.#view.hide();
    const win = this.#view.win();
    this.#timerWin = win;
    this.#timer = win.setTimeout(() => {
      if (this.#pendingOpen !== pendingOpen) return;
      this.#view.showLoading();
      this.#settle(pendingOpen);
    }, LOADING_REVEAL_MS);
  }

  close(): void {
    this.#clearTimer();
    this.#pendingOpen = null;
  }

  track<T>(answer: T[] | Promise<T[]>): T[] | Promise<T[]> {
    const pendingOpen = this.#pendingOpen;
    if (!pendingOpen) return answer;
    if (Array.isArray(answer)) {
      this.#settle(pendingOpen);
      return answer;
    }
    return answer.finally(() => this.#settle(pendingOpen));
  }

  #settle(pendingOpen: object): void {
    if (this.#pendingOpen !== pendingOpen) return;
    this.#clearTimer();
    this.#pendingOpen = null;
    this.#view.reveal();
  }

  #clearTimer(): void {
    this.#timerWin?.clearTimeout(this.#timer);
    this.#timerWin = null;
    this.#timer = undefined;
  }
}
