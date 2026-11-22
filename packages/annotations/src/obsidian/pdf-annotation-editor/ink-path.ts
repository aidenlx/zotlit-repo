import type { PdfPoint } from "./geometry-edit.ts";

import {
  MAX_POSITION_LENGTH,
  roundCoordinate,
  writePosition,
} from "#obsidian/annotation-repository/write.ts";

const MIN_POINT_DISTANCE = 1;

const INK_REACH_FLOOR = 7;

export function smoothPath(points: readonly number[]): number[] {
  return filterClosePoints(chaikin(chaikin(points)));
}

export function keepsSample(
  last: PdfPoint | undefined,
  sample: PdfPoint,
): boolean {
  return last === undefined || apart(last, sample) >= MIN_POINT_DISTANCE;
}

export function clampToViewBox(
  [x, y]: PdfPoint,
  viewBox: readonly number[],
): PdfPoint {
  const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = viewBox;
  return [Math.min(Math.max(x, x1), x2), Math.min(Math.max(y, y1), y2)];
}

export function inkReach(width: number): number {
  return Math.max(INK_REACH_FLOOR, width);
}

export function nearStroke(
  point: PdfPoint,
  paths: readonly (readonly PdfPoint[])[],
  reach: number,
): boolean {
  return paths.some((path) =>
    path.some(
      (from, index) =>
        distanceToSegment(point, from, path[index + 1] ?? from) < reach,
    ),
  );
}

function distanceToSegment(point: PdfPoint, a: PdfPoint, b: PdfPoint): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = dx * dx + dy * dy;
  if (length === 0) return apart(point, a);
  const t = Math.min(
    Math.max(((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length, 0),
    1,
  );
  return apart(point, [a[0] + t * dx, a[1] + t * dy]);
}

export const MAX_POINTS_PER_SAMPLE = 7;

export class StrokeSamples {
  readonly #frame;
  #raw: number[] = [];
  #room = 0;
  #coordinateLength = 0;

  constructor(frame: { pageIndex: number; width: number }) {
    this.#frame = frame;
  }

  get path(): number[] {
    return smoothPath(this.#raw);
  }

  take(point: PdfPoint): number[] | null {
    if (!keepsSample(this.#last(), point)) return null;
    if (this.#spend(point)) {
      this.#raw.push(...point);
      return null;
    }
    const finished = this.finish();
    const seam: PdfPoint = [finished.at(-2)!, finished.at(-1)!];
    this.#raw = [];
    this.#room = 0;
    for (const next of [seam, point]) {
      if (!keepsSample(this.#last(), next)) continue;
      this.#spend(next);
      this.#raw.push(...next);
    }
    return finished;
  }

  finish(): number[] {
    return smoothPath(this.#raw).map(roundCoordinate);
  }

  #last(): PdfPoint | undefined {
    return this.#raw.length > 0
      ? [this.#raw.at(-2)!, this.#raw.at(-1)!]
      : undefined;
  }

  #spend(point: PdfPoint): boolean {
    this.#coordinateLength = Math.max(
      this.#coordinateLength,
      ...point.map(writtenLength),
    );
    const bound = MAX_POINTS_PER_SAMPLE * 2 * this.#coordinateLength;
    if (bound <= this.#room) {
      this.#room -= bound;
      return true;
    }
    this.#room =
      MAX_POSITION_LENGTH -
      writePosition({
        ...this.#frame,
        paths: [smoothPath([...this.#raw, ...point])],
      }).length;
    return this.#room >= 0;
  }
}

function writtenLength(value: number): number {
  return 1 + String(Math.trunc(Math.abs(value)) + 1).length + 1 + 3 + 1;
}

function chaikin(points: readonly number[]): readonly number[] {
  if (points.length < 4) return points;
  const smoothed = [points[0]!, points[1]!];
  for (let index = 0; index < points.length - 2; index += 2) {
    const x1 = points[index]!;
    const y1 = points[index + 1]!;
    const x2 = points[index + 2]!;
    const y2 = points[index + 3]!;
    smoothed.push(
      0.75 * x1 + 0.25 * x2,
      0.75 * y1 + 0.25 * y2,
      0.25 * x1 + 0.75 * x2,
      0.25 * y1 + 0.75 * y2,
    );
  }
  smoothed.push(points.at(-2)!, points.at(-1)!);
  return smoothed;
}

function filterClosePoints(points: readonly number[]): number[] {
  const kept = [points[0]!, points[1]!];
  for (let index = 2; index < points.length; index += 2) {
    const point: PdfPoint = [points[index]!, points[index + 1]!];
    if (apart([kept.at(-2)!, kept.at(-1)!], point) >= MIN_POINT_DISTANCE) {
      kept.push(...point);
    }
  }
  return kept;
}

function apart(a: PdfPoint, b: PdfPoint): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return Math.sqrt(dx * dx + dy * dy);
}
