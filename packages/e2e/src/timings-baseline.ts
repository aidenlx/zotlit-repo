#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

import type { RunTimings } from "./run-timings.ts";
import { TIMINGS_BASELINE } from "./timed-sequencer.ts";

const sources = process.argv.slice(2);
if (sources.length === 0) {
  console.error(
    "Usage: pnpm --filter @zotlit/e2e timings:baseline <timings.json>...\nWrites the file times of each End-to-end Run's timings.json into timings-baseline.json, which the shard plan reads.",
  );
  process.exit(2);
}
const baseline = JSON.parse(readFileSync(TIMINGS_BASELINE, "utf8")) as Record<
  string,
  number
>;
for (const source of sources) {
  const run = JSON.parse(readFileSync(source, "utf8")) as RunTimings;
  for (const module of run.modules) baseline[module.file] = module.ms;
}
const sorted = Object.fromEntries(
  Object.entries(baseline).sort(([a], [b]) => a.localeCompare(b)),
);
writeFileSync(TIMINGS_BASELINE, `${JSON.stringify(sorted, null, 2)}\n`);
console.log(`timings-baseline.json: ${Object.keys(sorted).length} files.`);
