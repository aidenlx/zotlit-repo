import type { ReaderPage } from "./creation.ts";
import type { Point } from "./hit-test.ts";
import { clampToViewBox, StrokeSamples } from "./ink-path.ts";
import type { ReaderSurface } from "./reader-surface-model.ts";
import { update } from "./reader-surface-model.ts";
import { clearLiveStroke, publishLiveStroke } from "./reader-surface-state.ts";
import { pdfPointAt } from "./surface.ts";

export interface InkStrokeOptions {
  pointerId: number;
  page: ReaderPage;
  at: Point;
  width: number;
  color: string;
  surface: ReaderSurface;
  win: Window;
  onSplit: (path: number[]) => void;
}

export class InkStroke implements Disposable {
  readonly pointerId: number;
  readonly page: ReaderPage;
  readonly width: number;
  readonly color: string;
  readonly #options;
  readonly #samples: StrokeSamples;
  #frame: number | null = null;

  constructor(options: InkStrokeOptions) {
    this.#options = options;
    this.pointerId = options.pointerId;
    this.page = options.page;
    this.width = options.width;
    this.color = options.color;
    this.#samples = new StrokeSamples({
      pageIndex: options.page.pageIndex,
      width: options.width,
    });
    this.#take(options.at);
    this.#publish();
  }

  move(event: PointerEvent): void {
    const coalesced = event.getCoalescedEvents?.() ?? [];
    for (const sample of coalesced.length > 0 ? coalesced : [event])
      this.#take({ x: sample.clientX, y: sample.clientY });
    this.#frame ??= this.#options.win.requestAnimationFrame(() => {
      this.#frame = null;
      this.#publish();
    });
  }

  finish(): number[] {
    this[Symbol.dispose]();
    return this.#samples.finish();
  }

  [Symbol.dispose](): void {
    if (this.#frame !== null)
      this.#options.win.cancelAnimationFrame(this.#frame);
    this.#frame = null;
    update(this.#options.surface, clearLiveStroke);
  }

  #take(client: Point): void {
    const { view } = this.page;
    const finished = this.#samples.take(
      clampToViewBox(pdfPointAt(view, client), view.viewport.viewBox),
    );
    if (!finished) return;
    this.#options.onSplit(finished);
    this.#publish();
  }

  #publish(): void {
    update(
      this.#options.surface,
      publishLiveStroke({
        pageIndex: this.page.pageIndex,
        paths: [this.#samples.path],
        width: this.width,
        color: this.color,
      }),
    );
  }
}
