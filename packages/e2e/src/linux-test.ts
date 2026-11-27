import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { constants } from "node:os";
import { resolve } from "node:path";

import {
  EXIT_USAGE,
  LINUX_TEST_HELP,
  linuxTestDockerArgs,
  parseLinuxTestArgs,
  usesElectron,
} from "@zotlit/scripts/linux-test";
import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

import { ensureImage, runImage, worktreeFiles } from "./container-launch.ts";

const args = parseLinuxTestArgs(process.argv.slice(2));
if (args.kind === "help") {
  console.log(LINUX_TEST_HELP);
  process.exit(0);
}
if (args.kind === "usage") {
  console.error(`test:linux: ${args.message} See pnpm test:linux --help.`);
  process.exit(EXIT_USAGE);
}

const workspaceRoot = await getWorkspaceRoot(import.meta.dirname);
const pkg = resolve(workspaceRoot, args.pkg);
const missing = [
  resolve(pkg, "package.json"),
  ...args.files.map((file) => resolve(pkg, file)),
].filter((path) => !existsSync(path));
if (missing.length > 0) {
  console.error(`test:linux: these files do not exist:\n${missing.join("\n")}`);
  process.exit(EXIT_USAGE);
}

const image = runImage(workspaceRoot);
ensureImage(image);
const child = spawn(
  "docker",
  linuxTestDockerArgs({
    image: image.tag,
    arch: process.arch,
    uid: process.getuid?.() || 1000,
    gid: process.getgid?.() || 1000,
    workspaceRoot,
    pkg: args.pkg,
    files: args.files,
    electron: args.files.some((file) =>
      usesElectron(readFileSync(resolve(pkg, file), "utf8")),
    ),
    name: `zotlit-test-linux-${process.pid}`,
  }),
  { stdio: ["pipe", "inherit", "inherit"] },
);
child.stdin.end(worktreeFiles(workspaceRoot));
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const)
  process.on(signal, () => child.kill(signal));
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  process.exitCode = code ?? 128 + (signal ? constants.signals[signal] : 0);
});
