import type { Fiber } from "effect";
import { Context } from "effect";
import { MixedScheduler } from "effect/Scheduler";

export const SLICE_BUDGET_MS = 4;

export type Pause = (resume: () => void) => () => void;

export interface ItemQuerySchedulerOptions {
  budgetMs?: number;
  now?: () => number;
  pause?: Pause;
}

export interface SliceObserver {
  paused(at: number): void;
  resumed(at: number): void;
}

export const ItemQuerySliceObserver = Context.Reference<SliceObserver>(
  "@zotlit/item-query/ItemQuerySliceObserver",
  { defaultValue: () => ({ paused: () => {}, resumed: () => {} }) },
);

interface Slice {
  start: number | undefined;
  observer: SliceObserver | undefined;
}

export class ItemQueryScheduler extends MixedScheduler {
  readonly #budgetMs: number;
  readonly #now: () => number;
  readonly #slice: Slice;

  constructor(options: ItemQuerySchedulerOptions = {}) {
    const now = options.now ?? (() => performance.now());
    const pause = options.pause ?? messageChannelPause();
    const slice: Slice = { start: undefined, observer: undefined };
    super("async", (resume) =>
      pause(() => {
        slice.start = now();
        slice.observer?.resumed(slice.start);
        resume();
      }),
    );
    this.#budgetMs = options.budgetMs ?? SLICE_BUDGET_MS;
    this.#now = now;
    this.#slice = slice;
  }

  override shouldYield(fiber: Fiber.Fiber<unknown, unknown>): boolean {
    const now = this.#now();
    if (this.#slice.start === undefined) {
      this.#slice.start = now;
      return false;
    }
    if (now - this.#slice.start < this.#budgetMs) return false;
    this.#slice.observer = fiber.getRef(ItemQuerySliceObserver);
    this.#slice.observer.paused(now);
    return true;
  }
}

export function messageChannelPause(): Pause {
  let channel: MessageChannel | undefined;
  const waiting: { resume: () => void; live: boolean }[] = [];

  const open = (): MessageChannel => {
    const opened = new MessageChannel();
    opened.port1.onmessage = () => {
      const next = waiting.shift();
      if (waiting.length === 0) {
        opened.port1.close();
        channel = undefined;
      }
      if (next?.live) next.resume();
    };
    return opened;
  };

  return (resume) => {
    channel ??= open();
    const entry = { resume, live: true };
    waiting.push(entry);
    channel.port2.postMessage(0);
    return () => {
      entry.live = false;
    };
  };
}
