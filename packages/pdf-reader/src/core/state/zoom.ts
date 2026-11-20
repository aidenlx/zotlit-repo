import type { ReaderZoom } from "#/core/types.ts";

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 10;
const ZOOM_STEP = 1.1;
const PRESETS: readonly string[] = [
  "page-width",
  "page-height",
  "page-fit",
  "auto",
];

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function zoomOf(value: string | undefined, scale: number): ReaderZoom {
  return value !== undefined && PRESETS.includes(value)
    ? (value as ReaderZoom)
    : scale;
}

export function stepped(scale: number, direction: 1 | -1): number {
  const next =
    direction > 0
      ? Math.ceil(Number((scale * ZOOM_STEP).toFixed(2)) * 10) / 10
      : Math.floor(Number((scale / ZOOM_STEP).toFixed(2)) * 10) / 10;
  return clampZoom(next);
}
