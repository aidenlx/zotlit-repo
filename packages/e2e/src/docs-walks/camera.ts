import type { ClipSettings } from "./clip-settings.ts";
import { defaultClipSettings } from "./clip-settings.ts";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type CameraEvent =
  | { kind: "point"; t: number; x: number; y: number; rect?: Rect }
  | { kind: "park"; t: number; x: number; y: number }
  | { kind: "drag"; t: number; end: number; from: Spot; to: Spot }
  | { kind: "type"; t: number; end: number; rect: Rect }
  | { kind: "keys"; t: number; end: number; rect?: Rect }
  | { kind: "look"; t: number; rect: Rect; padding?: number };

export interface Spot {
  x: number;
  y: number;
  rect?: Rect;
}

export interface CameraTrack {
  keyframes: { t: number; view: Rect }[];
}

export interface CameraPlanInput {
  viewport: { width: number; height: number };
  duration: number;
  events: readonly CameraEvent[];
}

export type CameraPlanOptions = Partial<
  Pick<
    ClipSettings,
    | "zoom"
    | "hold"
    | "openHold"
    | "lead"
    | "ease"
    | "minEase"
    | "central"
    | "context"
    | "padding"
  >
>;

const defaults: Required<CameraPlanOptions> = {
  zoom: defaultClipSettings.zoom,
  hold: defaultClipSettings.hold,
  openHold: defaultClipSettings.openHold,
  lead: defaultClipSettings.lead,
  ease: defaultClipSettings.ease,
  minEase: defaultClipSettings.minEase,
  central: defaultClipSettings.central,
  context: defaultClipSettings.context,
  padding: defaultClipSettings.padding,
};

const ZOOM_IN = 0.8;

export function planCamera(
  input: CameraPlanInput,
  options: CameraPlanOptions = {},
): CameraTrack {
  const o = { ...defaults, ...options };
  const { width: W, height: H } = input.viewport;
  const full: Rect = { x: 0, y: 0, w: W, h: H };
  const keyframes: CameraTrack["keyframes"] = [{ t: 0, view: full }];
  let current = full;
  let free = o.openHold;
  let arrived = 0;
  let busy = 0;

  const actions = input.events
    .flatMap((e) => frame(e, input.viewport, o) ?? [])
    .toSorted((a, b) => a.t - b.t);
  let held = 0;

  const fold = (view: Rect, deadline: number) => {
    let area = view;
    while (keyframes.length > 1 && keyframes.at(-1)!.t > deadline) {
      area = union(area, keyframes.at(-1)!.view);
      keyframes.splice(-2);
    }
    const last = keyframes.at(-1)!;
    last.view = fit(union(last.view, area), input.viewport, [1, o.zoom]);
    current = last.view;
    arrived = last.t;
  };

  for (const [i, next] of actions.entries()) {
    const shown = inside(next.need, centre(current, o.central));
    const start = Math.max(
      free,
      next.still && !shown ? held : busy,
      next.by - o.ease,
    );
    const length = Math.min(o.ease, Math.max(o.minEase, next.by - start));
    const arrive = start + length;
    const group = actions
      .slice(i)
      .filter((a) => a.by < arrive + o.hold + o.ease);
    const shot = fit(group.map((a) => a.frame).reduce(union), input.viewport, [
      1,
      o.zoom,
    ]);
    const view = !shown
      ? fit(union(current, shot), input.viewport, [1, o.zoom])
      : shot.w <= ZOOM_IN * current.w && next.by - start >= o.ease
        ? shot
        : undefined;
    const moves = view !== undefined && !sameView(view, current);
    if (next.still && (moves ? arrive : arrived) > next.by) {
      fold(moves ? view : current, next.by);
      busy = Math.max(busy, next.end);
      held = next.end;
      continue;
    }
    if (next.still) held = next.end;
    if (!moves) {
      busy = Math.max(busy, next.end);
      continue;
    }
    keyframes.push({ t: start, view: current }, { t: arrive, view });
    current = view;
    arrived = arrive;
    free = arrive + o.hold;
    busy = next.end;
  }
  keyframes.push({ t: Math.max(input.duration, arrived), view: current });
  return { keyframes };
}

export function closingPad(
  track: CameraTrack,
  duration: number,
  { endPad, hold }: Pick<ClipSettings, "endPad" | "hold">,
): number {
  const keys = track.keyframes;
  let arrival: number | undefined;
  for (let i = 1; i < keys.length; i++)
    if (
      keys[i]!.t > keys[i - 1]!.t &&
      !sameView(keys[i - 1]!.view, keys[i]!.view)
    )
      arrival = keys[i]!.t;
  return arrival === undefined
    ? endPad
    : Math.max(endPad, hold - (duration - arrival));
}

export function openingPad(
  track: CameraTrack,
  { openPad, hold }: Pick<ClipSettings, "openPad" | "hold">,
  cut = Infinity,
): number {
  const keys = track.keyframes;
  let change = cut;
  for (let i = 1; i < keys.length; i++)
    if (
      keys[i]!.t > keys[i - 1]!.t &&
      !sameView(keys[i - 1]!.view, keys[i]!.view)
    ) {
      change = Math.min(change, keys[i - 1]!.t);
      break;
    }
  return change === Infinity ? openPad : Math.max(openPad, hold - change);
}

export function viewAt(track: CameraTrack, t: number): Rect {
  const keys = track.keyframes;
  if (keys.length === 0) throw new Error("a camera track needs a keyframe");
  if (t <= keys[0]!.t) return keys[0]!.view;
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i]!;
    if (t >= b.t) continue;
    const a = keys[i - 1]!;
    const p = b.t > a.t ? easeInOut((t - a.t) / (b.t - a.t)) : 1;
    const mix = (u: number, v: number) => u + (v - u) * p;
    return {
      x: mix(a.view.x, b.view.x),
      y: mix(a.view.y, b.view.y),
      w: mix(a.view.w, b.view.w),
      h: mix(a.view.h, b.view.h),
    };
  }
  return keys.at(-1)!.view;
}

interface Action {
  t: number;
  by: number;
  end: number;
  need: Rect;
  frame: Rect;
  still?: true;
}

function frame(
  event: CameraEvent,
  viewport: CameraPlanInput["viewport"],
  o: Required<CameraPlanOptions>,
): Action | undefined {
  const whole = { x: 0, y: 0, w: viewport.width, h: viewport.height };
  const clip = (r: Rect) => meet(r, whole) ?? whole;
  switch (event.kind) {
    case "park":
      return undefined;
    case "look": {
      const need = clip(pad(event.rect, event.padding ?? o.padding));
      return {
        t: event.t,
        by: event.t + o.ease,
        end: event.t,
        need,
        frame: need,
      };
    }
    case "point": {
      const need = clip(pointArea(event, viewport, o));
      return {
        t: event.t,
        by: event.t - o.lead,
        end: event.t,
        need,
        frame: clip(pad(need, o.context)),
      };
    }
    case "drag": {
      const ends = union(
        pointArea(event.from, viewport, o),
        pointArea(event.to, viewport, o),
      );
      const need = clip(pad(clip(ends), o.context));
      return {
        t: event.t,
        by: event.t - o.lead,
        end: event.end,
        need,
        frame: need,
        still: true,
      };
    }
    case "type":
    case "keys": {
      const need = clip(pad(event.rect ?? whole, o.padding));
      return {
        t: event.t,
        by: event.t - o.lead,
        end: event.end,
        need,
        frame: clip(pad(need, o.context)),
      };
    }
  }
}

function pointArea(
  s: Spot,
  viewport: CameraPlanInput["viewport"],
  o: Required<CameraPlanOptions>,
): Rect {
  const mark = pad({ x: s.x, y: s.y, w: 0, h: 0 }, 48);
  const element = s.rect && pad(s.rect, o.padding);
  return element && fits(union(element, mark), viewport, o.zoom)
    ? union(element, mark)
    : mark;
}

function fit(
  rect: Rect,
  viewport: CameraPlanInput["viewport"],
  [minZoom, maxZoom]: readonly [number, number],
): Rect {
  const { width: W, height: H } = viewport;
  const need = Math.max(rect.w, (rect.h * W) / H);
  const w = Math.min(W / minZoom, Math.max(W / maxZoom, need));
  const h = (w * H) / W;
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  return {
    x: clamp(cx - w / 2, 0, W - w),
    y: clamp(cy - h / 2, 0, H - h),
    w,
    h,
  };
}

function fits(
  rect: Rect,
  viewport: CameraPlanInput["viewport"],
  zoom: number,
): boolean {
  return rect.w <= viewport.width / zoom && rect.h <= viewport.height / zoom;
}

function centre(view: Rect, share: number): Rect {
  const w = view.w * share;
  const h = view.h * share;
  return { x: view.x + (view.w - w) / 2, y: view.y + (view.h - h) / 2, w, h };
}

function inside(a: Rect, b: Rect): boolean {
  return (
    a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h
  );
}

function meet(a: Rect, b: Rect): Rect | undefined {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const w = Math.min(a.x + a.w, b.x + b.w) - x;
  const h = Math.min(a.y + a.h, b.y + b.h) - y;
  return w > 0 && h > 0 ? { x, y, w, h } : undefined;
}

function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}

function pad(r: Rect, by: number): Rect {
  return { x: r.x - by, y: r.y - by, w: r.w + 2 * by, h: r.h + 2 * by };
}

function sameView(a: Rect, b: Rect): boolean {
  return (
    Math.abs(a.x - b.x) < 1 &&
    Math.abs(a.y - b.y) < 1 &&
    Math.abs(a.w - b.w) < 1 &&
    Math.abs(a.h - b.h) < 1
  );
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), Math.max(lo, hi));
}

function easeInOut(p: number): number {
  return p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2;
}
