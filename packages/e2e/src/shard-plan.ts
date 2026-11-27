export interface ShardFile {
  readonly id: string;
  readonly ms: number | undefined;
}

const DEFAULT_MS = 30_000;

function median(values: readonly number[]): number {
  if (values.length === 0) return DEFAULT_MS;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

export function planShards(
  files: readonly ShardFile[],
  count: number,
): string[][] {
  const known = files.flatMap(({ ms }) => (ms === undefined ? [] : [ms]));
  const fallback = median(known);
  const weighted = files
    .map(({ id, ms }) => ({ id, ms: ms ?? fallback }))
    .sort((a, b) => b.ms - a.ms || a.id.localeCompare(b.id));
  const shards = Array.from({ length: count }, () => ({
    ms: 0,
    ids: [] as string[],
  }));
  for (const file of weighted) {
    const lightest = shards.reduce((best, shard) =>
      shard.ms < best.ms ? shard : best,
    );
    lightest.ms += file.ms;
    lightest.ids.push(file.id);
  }
  return shards.map(({ ids }) => ids);
}
