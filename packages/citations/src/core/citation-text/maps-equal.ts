export function mapsEqual<K, V>(
  prev: ReadonlyMap<K, V>,
  next: ReadonlyMap<K, V>,
  same: (prev: V, next: V) => boolean,
): boolean {
  if (prev.size !== next.size) return false;
  for (const [key, value] of prev) {
    if (!next.has(key) || !same(value, next.get(key)!)) return false;
  }
  return true;
}
