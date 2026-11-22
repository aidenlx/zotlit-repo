export type RowPath = readonly number[];

export function pathStartsWith(path: RowPath, prefix: RowPath): boolean {
  return (
    prefix.length <= path.length &&
    prefix.every((at, depth) => path[depth] === at)
  );
}

export function samePath(a: RowPath, b: RowPath): boolean {
  return a.length === b.length && pathStartsWith(a, b);
}
