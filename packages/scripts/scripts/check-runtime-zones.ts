#!/usr/bin/env node
import type { ZoneName } from "#runtime-check";
import { performance } from "node:perf_hooks";

import { getWorkspaceRoot } from "#package-roots";
import { checkZone } from "#runtime-check";

const CHECKED_ZONES: readonly ZoneName[] = [
  "worker",
  "host-free",
  "obsidian",
  "desktop",
];

const workspaceRoot = await getWorkspaceRoot(import.meta.dirname);
const start = performance.now();
const reports = await Promise.all(
  CHECKED_ZONES.map((zone) => checkZone(workspaceRoot, zone)),
);
const seconds = ((performance.now() - start) / 1000).toFixed(1);

const violations = reports.flatMap(({ violations }) => violations);
for (const { file, rule, chain } of violations) {
  console.error(`${file}\n  ${rule}\n  ${chain.join("\n  → ")}`);
}
const summary = reports
  .map(({ zone, files }) => `${zone} ${files} files`)
  .join(", ");
if (violations.length > 0) {
  console.error(
    `check-runtime-zones: ${violations.length} violation(s) in ${summary} (${seconds} s). See docs/adr/0117-runtime-zones-are-checked-by-the-module-graph.md.`,
  );
  process.exitCode = 1;
} else {
  console.log(`check-runtime-zones: ${summary}, no violation (${seconds} s).`);
}
