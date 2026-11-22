#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { parseManifest } from "#obsidian-manifest";
import { getWorkspaceRoot } from "#package-roots";
import { PUBLISHED_PLUGINS } from "#shell/plugins";

const workspaceRoot = await getWorkspaceRoot(import.meta.dirname);
const failed: string[] = [];
for (const { app } of Object.values(PUBLISHED_PLUGINS)) {
  const pkg = JSON.parse(
    await readFile(join(workspaceRoot, app, "package.json"), "utf8"),
  );
  const manifest = `${JSON.stringify(parseManifest(pkg), null, 2)}\n`;

  try {
    execFileSync(
      "pnpm",
      [
        "exec",
        "eslint",
        "--quiet",
        "--stdin",
        "--stdin-filename",
        "manifest.json",
      ],
      {
        cwd: workspaceRoot,
        input: manifest,
        stdio: ["pipe", "inherit", "inherit"],
      },
    );
  } catch {
    failed.push(app);
  }
}
if (failed.length > 0) {
  console.error(
    `The manifest generated from ${failed.map((app) => `${app}/package.json`).join(" and ")} fails the Obsidian manifest rules above.`,
  );
  process.exit(1);
}
