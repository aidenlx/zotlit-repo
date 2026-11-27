#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { $ } from "zx";

import { checkGuide, GUIDE_BASELINE } from "#agent-guide-size";
import { getWorkspaceRoot } from "#package-roots";

const root = await getWorkspaceRoot(import.meta.dirname);
const guides = (
  await $({ cwd: root, quiet: true })`git ls-files -- ${":(glob)**/AGENTS.md"}`
).stdout
  .split("\n")
  .filter(Boolean);

const failures: string[] = [];
for (const path of Object.keys(GUIDE_BASELINE)) {
  if (!guides.includes(path))
    failures.push(
      `${path} is in GUIDE_BASELINE but is not a tracked guide: remove it from GUIDE_BASELINE.`,
    );
}
for (const path of guides) {
  const text = await readFile(join(root, path), "utf8");
  const result = checkGuide(path, text, GUIDE_BASELINE[path]);
  if (!result.ok) failures.push(result.message);
  else if (result.note) console.log(result.note);
}

if (failures.length > 0) {
  for (const failure of failures) console.error(failure);
  process.exitCode = 1;
} else {
  console.log(
    `check-agent-guides: ${guides.length} guides, none above its limit or baseline.`,
  );
}
