import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chownSync, mkdirSync, statSync } from "node:fs";
import { constants, hostname } from "node:os";
import { resolve } from "node:path";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import {
  ADMISSION_DEADLINE_MS,
  DESKTOP_WAIT_ENV,
  EXIT_ADMISSION_BLOCKED,
} from "@zotlit/config/memory-gate";
import { admitMemoryRun } from "@zotlit/scripts/memory-admission";
import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

import {
  IMAGE_ARCHIVE_ENV,
  docker,
  ensureImage,
  runImage,
  worktreeFiles,
} from "./container-launch.ts";
import { HOLD_ENV, HOLD_FILE } from "./hold-mode.ts";
import { E2E_PERFORMANCE_ENV } from "./performance-mode.ts";
import {
  E2E_RESULTS_ENV,
  e2eResultsDir,
  publishE2eResultsDir,
} from "./results-dir.ts";

const VNC_ENV = "ZOTLIT_E2E_VNC";
const vitestArgs = hideBin(process.argv);
const help = yargs([])
  .scriptName("pnpm e2e")
  .usage("$0 [Vitest arguments]")
  .version(false)
  .option("image-tag", {
    type: "boolean",
    description: "Print the pinned image tag and exit",
  })
  .help()
  .epilogue(
    `The Run Container builds a pinned image when needed and runs Vitest in an isolated desktop. The guest copies tracked and unignored worktree files, including local changes. Pass Vitest file filters, --project, or -t directly.

Set ${HOLD_ENV}=1 to inspect the guest while you write a journey. After each case and its afterEach hooks, the run writes ${HOLD_FILE} to the evidence folder and waits until you delete it. The file names the case, its state, the container, the open vault ids, and the Paired Zotero debugger port (null in the desktop project). \`docker exec <container> <command>\` runs in the guest copy of the worktree with the guest's display and Obsidian CLI socket; /results is the evidence folder.

Set ${VNC_ENV}=<port> to watch over VNC at 127.0.0.1. Evidence goes to .scratch/e2e-results or the folder named in ${E2E_RESULTS_ENV}.

Set ${IMAGE_ARCHIVE_ENV}=<path> to load a saved image when the local image is absent and save the pinned image when the archive is absent or the loaded archive did not contain it.

Set ${DESKTOP_WAIT_ENV}=<duration> to change the Memory Gate admission deadline (default ${ADMISSION_DEADLINE_MS / 60_000} min). Exit ${EXIT_ADMISSION_BLOCKED} means blocked at admission. The launcher returns the run's exit status.`,
  );
if (vitestArgs.length === 1 && ["--help", "-h"].includes(vitestArgs[0]!)) {
  help.showHelp("log");
  process.exit(0);
}

const workspaceRoot = await getWorkspaceRoot(import.meta.dirname);
const ownerLabel = "org.zotlit.e2e.owner";
const worktreeLabel = "org.zotlit.e2e.worktree";

const image = runImage(workspaceRoot);
if (vitestArgs.length === 1 && vitestArgs[0] === "--image-tag") {
  console.log(image.tag);
  process.exit(0);
}

function removeStaleRuns(worktree: string): void {
  const rows = docker([
    "ps",
    "--all",
    "--filter",
    `label=${worktreeLabel}=${worktree}`,
    "--format",
    `{{.ID}} {{.Label "${ownerLabel}"}}`,
  ]);
  if (!rows) return;
  for (const row of rows.split("\n")) {
    const [id, owner] = row.split(" ");
    const pid = Number(owner);
    if (!id || !Number.isInteger(pid) || pid <= 0) continue;
    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH")
        docker(["rm", "--force", id]);
    }
  }
}

const vnc = process.env[VNC_ENV];
if (
  vnc !== undefined &&
  (!Number.isInteger(Number(vnc)) || Number(vnc) < 1 || Number(vnc) > 65_535)
)
  throw new Error(`Set ${VNC_ENV} to a local TCP port (1–65535).`);

await admitMemoryRun();

const worktree = createHash("sha256")
  .update(JSON.stringify([hostname(), workspaceRoot]))
  .digest("hex");
removeStaleRuns(worktree);
ensureImage(image);
const files = worktreeFiles(workspaceRoot);
const results = resolve(e2eResultsDir());
const createdResults = mkdirSync(results, { recursive: true });
publishE2eResultsDir(results);
console.log(`E2E evidence: ${results}`);

const uid = process.getuid?.() ?? 1000;
const runtimeUid = uid || statSync(results).uid || 1000;
const runtimeGid =
  (process.getgid?.() ?? 1000) || statSync(results).gid || 1000;
if (uid === 0 && createdResults) chownSync(results, runtimeUid, runtimeGid);

const child = spawn(
  "docker",
  [
    "run",
    "--rm",
    "--init",
    "--user",
    `${runtimeUid}:${runtimeGid}`,
    "--group-add",
    "1000",
    "--interactive",
    "--memory=4g",
    "--shm-size=1g",
    "--name",
    `zotlit-e2e-${worktree.slice(0, 12)}-${process.pid}`,
    "--label",
    `${worktreeLabel}=${worktree}`,
    "--label",
    `${ownerLabel}=${process.pid}`,
    "--mount",
    `type=bind,source=${workspaceRoot},target=/source,readonly`,
    "--mount",
    `type=bind,source=${results},target=/results`,
    "--mount",
    `type=volume,source=zotlit-e2e-pnpm-${process.arch}-u${runtimeUid},target=/pnpm-store`,
    "--env",
    "ZOTLIT_E2E_RESULTS=/results",
    "--env",
    `ZOTLIT_E2E_HOST_RESULTS=${results}`,
    "--env",
    "ANNOTATION_SUGGESTER_ENABLED",
    "--env",
    E2E_PERFORMANCE_ENV,
    "--env",
    HOLD_ENV,
    ...(vnc ? ["--publish", `127.0.0.1:${vnc}:5900`, "--env", VNC_ENV] : []),
    image.tag,
    ...vitestArgs,
  ],
  { stdio: ["pipe", "inherit", "inherit"] },
);
child.stdin.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code !== "EPIPE") console.error(error.message);
});
child.stdin.end(files);
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const)
  process.on(signal, () => child.kill(signal));
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  process.exitCode = code ?? 128 + (signal ? constants.signals[signal] : 0);
});
