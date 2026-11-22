import { regex } from "arkregex";

export interface GateShard {
  index: number;
  total: number;
}

export const GATE_SHARD_FLAG = "--shard";
export const GATE_SHARD_TAG = "ci-shard-";

const SHARD = regex("^(?<index>[1-9]\\d*)/(?<total>[1-9]\\d*)$");

export function parseGateShard(value: string): GateShard | undefined {
  const groups = SHARD.exec(value)?.groups;
  if (!groups) return undefined;
  const index = Number(groups.index);
  const total = Number(groups.total);
  return index <= total ? { index, total } : undefined;
}

export function isLastShard({ index, total }: GateShard): boolean {
  return index === total;
}

export function shardTestArgs(shard: GateShard): string[] {
  if (!isLastShard(shard)) return ["test", `--filter=${shardTag(shard.index)}`];
  return [
    "test",
    "//#test:eval-runtime",
    ...Array.from(
      { length: shard.total - 1 },
      (_, at) => `--filter=!${shardTag(at + 1)}`,
    ),
  ];
}

function shardTag(index: number): string {
  return `tag:${GATE_SHARD_TAG}${index}`;
}
