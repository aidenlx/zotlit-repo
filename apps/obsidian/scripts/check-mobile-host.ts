#!/usr/bin/env node
import { join, resolve } from "node:path";

import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";
import { checkRoot } from "@zotlit/scripts/runtime-check";

const packageRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = await getWorkspaceRoot(import.meta.dirname);
const { violations } = await checkRoot(workspaceRoot, "obsidian", [
  join(packageRoot, "src/__fixtures__/mobile-host/host.check.ts"),
]);
for (const { rule, chain } of violations) {
  process.stderr.write(`${rule}\n  ${chain.join("\n  → ")}\n`);
}
if (violations.length > 0) {
  process.stderr.write(
    `The Node-free host reaches ${violations.length} module(s) outside the Obsidian zone.\n`,
  );
  process.exitCode = 1;
} else process.stdout.write("The Node-free host stays in the Obsidian zone.\n");
