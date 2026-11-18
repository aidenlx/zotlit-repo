#!/usr/bin/env node
// The Node-free host's program holds no desktop file: no `desktop/` layer of
// a package, no `@zotlit/obsidian-desktop`, no `@effect/platform-node`, no
// Electron. tsconfig.mobile.json type-checks the host; this reads the files
// tsc puts in that program.
import { execFileSync } from "node:child_process";

const DESKTOP = [
  /\/packages\/[^/]+\/src\/desktop\//,
  /\/packages\/obsidian-desktop\//,
  /\/node_modules\/@effect\/platform-node\//,
  /\/node_modules\/electron\//,
  /\/packages\/db\/src\/client\/node/,
];

const files = execFileSync(
  "pnpm",
  ["exec", "tsc", "-p", "tsconfig.mobile.json", "--listFilesOnly"],
  { cwd: new URL("..", import.meta.url), encoding: "utf8" },
)
  .split("\n")
  .filter(Boolean);
const desktop = files.filter((file) =>
  DESKTOP.some((pattern) => pattern.test(file)),
);
if (desktop.length > 0) {
  process.stderr.write(
    `The Node-free host reads ${desktop.length} desktop files:\n${desktop.join("\n")}\n`,
  );
  process.exitCode = 1;
} else
  process.stdout.write(
    `The Node-free host's ${files.length} files hold no desktop file.\n`,
  );
