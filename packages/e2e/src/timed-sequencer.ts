import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import type { TestSpecification } from "vitest/node";
import { BaseSequencer } from "vitest/node";

import { planShards } from "./shard-plan.ts";

export const TIMINGS_BASELINE = resolve(
  import.meta.dirname,
  "../timings-baseline.json",
);

export default class TimedSequencer extends BaseSequencer {
  override async shard(
    files: TestSpecification[],
  ): Promise<TestSpecification[]> {
    const { shard, root } = this.ctx.config;
    if (!shard) return files;
    const baseline = JSON.parse(
      readFileSync(TIMINGS_BASELINE, "utf8"),
    ) as Record<string, number>;
    const id = (file: TestSpecification) => relative(root, file.moduleId);
    const plan = planShards(
      files.map((file) => ({ id: id(file), ms: baseline[id(file)] })),
      shard.count,
    );
    const chosen = new Set(plan[shard.index - 1]);
    return files.filter((file) => chosen.has(id(file)));
  }
}
