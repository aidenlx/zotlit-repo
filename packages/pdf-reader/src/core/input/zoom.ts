import { TouchManager } from "@zotlit/pdfjs/lib";

import { MAX_ZOOM, MIN_ZOOM } from "#/core/state/zoom.ts";

const PIXELS_PER_TICK = 30;
const LOCKOUT_MS = 1000;
const ZOOM_DELAY_MS = 400;
const DOM_DELTA_PIXEL = 0;

export interface ZoomTarget {
  readonly container: HTMLElement;
  readonly signal: AbortSignal;
  enabled(): boolean;
  now(): number;
  scale(): number;
  zoom(change: {
    readonly steps?: number;
    readonly scaleFactor?: number;
    readonly origin: readonly [number, number];
    readonly pan?: readonly [number, number];
    readonly drawingDelay: number;
  }): void;
  pan(dx: number, dy: number): void;
}

type Pinch = [
  origin: [number, number],
  previousDistance: number,
  distance: number,
  panX: number,
  panY: number,
];

function wheelDirection(event: WheelEvent): number {
  const delta = Math.hypot(event.deltaX, event.deltaY);
  const angle = Math.atan2(event.deltaY, event.deltaX);
  return -0.25 * Math.PI < angle && angle < 0.75 * Math.PI ? -delta : delta;
}

class Accumulator {
  #ticks = 0;
  #factor = 1;

  ticks(value: number): number {
    if ((this.#ticks > 0 && value < 0) || (this.#ticks < 0 && value > 0)) {
      this.#ticks = 0;
    }
    this.#ticks += value;
    const whole = Math.trunc(this.#ticks);
    this.#ticks -= whole;
    return whole;
  }

  factor(scale: number, factor: number): number {
    if (factor === 1) return 1;
    const target = Math.min(
      MAX_ZOOM,
      Math.max(MIN_ZOOM, scale * factor * this.#factor),
    );
    const next = Math.round(target * 100) / 100;
    this.#factor = target / next;
    return next / scale;
  }

  reset(): void {
    this.#ticks = 0;
    this.#factor = 1;
  }
}

export function bindZoomInput(target: ZoomTarget): void {
  const { container, signal } = target;
  const wheel = new Accumulator();
  const touch = new Accumulator();
  let lockedUntil = 0;
  container.addEventListener(
    "wheel",
    (event) => {
      const now = target.now();
      const scaleFactor = Math.exp(-event.deltaY / 100);
      const pinch =
        event.ctrlKey &&
        event.deltaMode === DOM_DELTA_PIXEL &&
        event.deltaX === 0 &&
        event.deltaZ === 0 &&
        Math.abs(scaleFactor - 1) < 0.05;
      if (!event.ctrlKey && !event.metaKey) {
        lockedUntil = now + LOCKOUT_MS;
        return;
      }
      event.preventDefault();
      if (!target.enabled() || now < lockedUntil) return;
      const origin = [event.clientX, event.clientY] as const;
      if (pinch) {
        target.zoom({
          scaleFactor: wheel.factor(target.scale(), scaleFactor),
          origin,
          drawingDelay: ZOOM_DELAY_MS,
        });
        return;
      }
      const delta = wheelDirection(event);
      const steps =
        event.deltaMode === DOM_DELTA_PIXEL
          ? wheel.ticks(delta / PIXELS_PER_TICK)
          : Math.abs(delta) >= 1
            ? Math.sign(delta)
            : wheel.ticks(delta);
      if (steps !== 0) {
        target.zoom({ steps, origin, drawingDelay: ZOOM_DELAY_MS });
      }
    },
    { passive: false, signal },
  );
  new TouchManager({
    container,
    isPinchingDisabled: () => !target.enabled(),
    onPinching: (
      ...[origin, previousDistance, distance, panX, panY]: Pinch
    ) => {
      target.zoom({
        scaleFactor: touch.factor(target.scale(), distance / previousDistance),
        origin,
        pan: [panX, panY],
        drawingDelay: ZOOM_DELAY_MS,
      });
    },
    onPinchEnd: () => touch.reset(),
    onPanning: (dx: number, dy: number) => target.pan(dx, dy),
    signal,
  });
}
