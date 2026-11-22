export type OutlineRect = readonly [number, number, number, number];

type Point = readonly [number, number];
type Interval = readonly [number, number];
type Edge = readonly [Point, Point];

const TOLERANCE = 0.01;

const PRECISION = 3;

export function unionOutlinePath(
  rects: readonly OutlineRect[],
  padding: number,
): string {
  if (rects.length === 0) return "";

  const spread = rects.map(([left, top, right, bottom]): OutlineRect => [
    left - padding,
    top - padding,
    right + padding,
    bottom + padding,
  ]);
  const xBand = bandAxis(spread.flatMap(([left, , right]) => [left, right]));
  const yBand = bandAxis(spread.flatMap(([, top, , bottom]) => [top, bottom]));
  const padded = spread.map(([left, top, right, bottom]): OutlineRect => [
    xBand.get(left)!,
    yBand.get(top)!,
    xBand.get(right)!,
    yBand.get(bottom)!,
  ]);

  const ys = distinctSorted(
    padded.flatMap(([, top, , bottom]) => [top, bottom]),
  );
  const rowIntervals: Interval[][] = [];
  for (let index = 0; index + 1 < ys.length; index++) {
    const top = ys[index]!;
    const bottom = ys[index + 1]!;
    rowIntervals.push(
      mergeIntervals(
        padded
          .filter(([, rTop, , rBottom]) => rTop <= top && rBottom >= bottom)
          .map(([left, , right]): Interval => [left, right]),
      ),
    );
  }

  const edges: Edge[] = [];
  for (let index = 0; index < ys.length; index++) {
    const above = rowIntervals[index - 1] ?? [];
    const below = rowIntervals[index] ?? [];
    const y = ys[index]!;
    for (const [left, right] of xorIntervals(above, below)) {
      edges.push([
        [left, y],
        [right, y],
      ]);
    }
  }
  for (let index = 0; index < rowIntervals.length; index++) {
    const top = ys[index]!;
    const bottom = ys[index + 1]!;
    for (const [left, right] of rowIntervals[index]!) {
      edges.push([
        [left, top],
        [left, bottom],
      ]);
      edges.push([
        [right, top],
        [right, bottom],
      ]);
    }
  }

  return traceLoops(edges)
    .map(pathOf)
    .filter((d) => d.length > 0)
    .join(" ");
}

function bandAxis(values: readonly number[]): Map<number, number> {
  const bands = new Map<number, number>();
  let band: number | undefined;
  for (const value of distinctSorted(values)) {
    if (band === undefined || value - band > TOLERANCE) band = value;
    bands.set(value, band);
  }
  return bands;
}

function distinctSorted(values: readonly number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function mergeIntervals(intervals: readonly Interval[]): Interval[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const merged: Interval[] = [sorted[0]!];
  for (const [left, right] of sorted.slice(1)) {
    const last = merged[merged.length - 1]!;
    if (left <= last[1])
      merged[merged.length - 1] = [last[0], Math.max(last[1], right)];
    else merged.push([left, right]);
  }
  return merged;
}

function xorIntervals(
  a: readonly Interval[],
  b: readonly Interval[],
): Interval[] {
  const points = distinctSorted(
    [...a, ...b].flatMap(([left, right]) => [left, right]),
  );
  const result: Interval[] = [];
  let start: number | null = null;
  for (let index = 0; index + 1 < points.length; index++) {
    const left = points[index]!;
    const right = points[index + 1]!;
    const middle = (left + right) / 2;
    const inA = a.some(
      ([aLeft, aRight]) => aLeft <= middle && middle <= aRight,
    );
    const inB = b.some(
      ([bLeft, bRight]) => bLeft <= middle && middle <= bRight,
    );
    if (inA !== inB) {
      start ??= left;
    } else if (start !== null) {
      result.push([start, left]);
      start = null;
    }
  }
  if (start !== null) result.push([start, points[points.length - 1]!]);
  return result;
}

function key([x, y]: Point): string {
  return `${x},${y}`;
}

interface Arc {
  to: Point;
  edgeIndex: number;
}

interface Vertex {
  point: Point;
  arcs: Arc[];
}

function traceLoops(edges: readonly Edge[]): Point[][] {
  const vertices = new Map<string, Vertex>();
  const vertexAt = (point: Point): Vertex => {
    const found = vertices.get(key(point));
    if (found) return found;
    const created: Vertex = { point, arcs: [] };
    vertices.set(key(point), created);
    return created;
  };
  edges.forEach(([a, b], edgeIndex) => {
    vertexAt(a).arcs.push({ to: b, edgeIndex });
    vertexAt(b).arcs.push({ to: a, edgeIndex });
  });

  const trace: Trace = { vertices, used: edges.map(() => false) };
  const loops: Point[][] = [];
  for (const vertex of vertices.values()) {
    for (const arc of vertex.arcs) {
      if (trace.used[arc.edgeIndex]) continue;
      loops.push(simplify(walkLoop(trace, vertex.point, arc)));
    }
  }
  return loops;
}

interface Trace {
  vertices: ReadonlyMap<string, Vertex>;
  used: boolean[];
}

function walkLoop(trace: Trace, start: Point, firstArc: Arc): Point[] {
  const loop: Point[] = [start];
  let current = start;
  let arc = firstArc;
  for (;;) {
    trace.used[arc.edgeIndex] = true;
    current = arc.to;
    loop.push(current);
    if (key(current) === key(start)) break;
    arc = nextArc(trace, current);
  }
  return loop;
}

function nextArc(trace: Trace, at: Point): Arc {
  const vertex = trace.vertices.get(key(at))!;
  return vertex.arcs.find((arc) => !trace.used[arc.edgeIndex])!;
}

function simplify(loop: readonly Point[]): Point[] {
  const points = loop.slice(0, -1);
  const result: Point[] = [];
  for (const point of points) {
    while (
      result.length >= 2 &&
      collinear(result[result.length - 2]!, result[result.length - 1]!, point)
    ) {
      result.pop();
    }
    result.push(point);
  }
  while (
    result.length >= 3 &&
    collinear(
      result[result.length - 2]!,
      result[result.length - 1]!,
      result[0]!,
    )
  ) {
    result.pop();
  }
  return result;
}

function collinear([x1, y1]: Point, [x2, y2]: Point, [x3, y3]: Point): boolean {
  return (x1 === x2 && x2 === x3) || (y1 === y2 && y2 === y3);
}

function pathOf(loop: readonly Point[]): string {
  if (loop.length === 0) return "";
  const [first, ...rest] = loop;
  const move = `M ${round(first![0])} ${round(first![1])}`;
  const lines = rest.map(([x, y]) => `L ${round(x)} ${round(y)}`).join(" ");
  return `${move} ${lines} Z`;
}

function round(value: number): number {
  const scale = 10 ** PRECISION;
  return Math.round(value * scale) / scale;
}
