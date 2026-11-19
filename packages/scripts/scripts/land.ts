#!/usr/bin/env node

// `pnpm land`: the only path by which a change reaches `next` (lib/land.ts).
// Run it from the task worktree, on its branch, with a clean tree. It waits in
// the Land Queue, rebases onto `origin/next`, runs `pnpm verify` on the
// rebased tree, and pushes. Then it starts the End-to-end Run of the new tip
// in the background (lib/land-e2e.ts).
// `pnpm land --to main` fast-forwards `main` to the checked-out commit of
// `next` after `pnpm verify --release`; `pnpm land --to main --hotfix` lands a
// task branch off `main` onto it, with the same gate.
// `--help` prints the contract.

import type { LandTarget } from "#land-queue";
import { spawn } from "node:child_process";
import { openSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { $ } from "zx";

import {
  describeHolder,
  describeWaiters,
  EXIT_ADMISSION_BLOCKED,
  formatDuration,
  MAX_LEASE_MS,
  parseDuration,
  readDesktopSlotStatus,
  SILENCE_LIMIT_MS,
} from "#desktop-slot";
import { land, LAND_ATTEMPTS, LAND_GATES, LAND_WAIT_MS } from "#land";
import { githubRepository, landE2eDir, requestLandE2e } from "#land-e2e";
import { landAdmission, landStateDir, landWaitLog } from "#land-queue";

const EXIT_USAGE = 2;
/** The lines of the log a failed gate prints. */
const GATE_TAIL = 40;

const epilogue = `A land holds the Land Turn of its target branch while it fetches, rebases, runs the gate, and pushes, so one land at a time reaches each branch on this machine, in the order the lands started. The gate cannot be skipped.

Into next (the default), from a task branch with a clean tree:
  fetch origin/next, rebase the branch onto it, run ${LAND_GATES.next.join(" ")}, push HEAD to next as a fast-forward. When next moved during the gate, the turn starts again from the fetch (${LAND_ATTEMPTS} attempts). Then the local next moves, the task branch is deleted on origin, and the End-to-end Run of the new tip starts in the background.
Into main (--to main), from a checked-out commit of next with a clean tree:
  check that main can fast-forward to it, run ${LAND_GATES.main.join(" ")}, push HEAD to main.
A hotfix into main (--to main --hotfix), from a task branch off main with a clean tree:
  as into next, with main in place of next and ${LAND_GATES.main.join(" ")} as the gate. The fix then reaches next through a land of a branch that merges main.

On a failure, land exits non-zero, names the failed step, and prints the path of the full log. The worktree stays on its branch with a clean tree: after a rebase conflict the branch is as it was; after a failed gate it is rebased onto the fetched next, the tree to fix.

Exit codes:
  0    landed
  1    a step failed
  ${EXIT_USAGE}    usage error
  ${EXIT_ADMISSION_BLOCKED}   the turn did not come within --wait; blocked, not a failure

Lease: each output of a step renews the Land Turn. A turn whose commands print nothing for ${formatDuration(SILENCE_LIMIT_MS.childOutput)} ends, and so does one past ${formatDuration(MAX_LEASE_MS)} in total. Default wait: ${formatDuration(LAND_WAIT_MS)}.
State and logs: ${landStateDir()} (wait log ${landWaitLog()}, End-to-end Runs ${join(landE2eDir(), "runs.jsonl")}).`;

function usage(message: string): never {
  console.error(`land: ${message}`);
  process.exit(EXIT_USAGE);
}

async function landCommand(
  to: LandTarget,
  hotfix: boolean,
  wait: string | undefined,
) {
  if (hotfix && to !== "main")
    usage("--hotfix lands into main: add --to main.");
  let waitMs: number | undefined;
  if (wait !== undefined) {
    try {
      waitMs = parseDuration(wait);
    } catch (error) {
      usage((error as Error).message);
    }
  }
  const cwd = process.cwd();
  const result = await land({
    cwd,
    to,
    hotfix,
    gate: LAND_GATES[to],
    ...(waitMs === undefined ? {} : { waitMs }),
  });
  if (!result.ok) {
    if (result.step === "gate") {
      const tail = readFileSync(result.logPath, "utf8")
        .trimEnd()
        .split("\n")
        .slice(-GATE_TAIL)
        .join("\n");
      console.error(`\n${tail}\n`);
    }
    console.error(
      `\n✖ land failed at the ${result.step} step: ${result.message}`,
    );
    console.error(`Full log: ${result.logPath}`);
    process.exit(result.exitCode);
  }
  if (to === "next") await startE2e(cwd, result.commit, result.previous);
}

/** Request the End-to-end Run of the new tip and start its detached runner. */
async function startE2e(cwd: string, commit: string, previous: string) {
  const git = $({ cwd, quiet: true, nothrow: true });
  const origin = (await git`git remote get-url origin`).stdout;
  const primary = (await git`git worktree list --porcelain`).stdout
    .split("\n")[0]
    ?.slice("worktree ".length);
  if (!primary) {
    console.error(
      "End-to-end Run: no primary worktree found; it does not start.",
    );
    return;
  }
  const dir = landE2eDir();
  await requestLandE2e(
    {
      commit,
      previous,
      repository: primary,
      issueRepository: githubRepository(origin),
      requestedAt: Temporal.Now.instant().toString(),
    },
    dir,
  );
  await mkdir(dir, { recursive: true });
  const out = openSync(join(dir, "runner.log"), "a");
  const child = spawn(
    process.execPath,
    [join(import.meta.dirname, "land-e2e.ts")],
    { cwd: dir, detached: true, stdio: ["ignore", out, out] },
  );
  child.unref();
  console.error(
    `End-to-end Run of ${commit.slice(0, 12)} starts in the background; results in ${join(dir, "runs.jsonl")}.`,
  );
}

async function status() {
  for (const target of ["next", "main"] as const) {
    const state = await readDesktopSlotStatus({
      admission: landAdmission(target),
    });
    const now = Temporal.Now.instant().epochMilliseconds;
    const holder = state.holders[0];
    console.log(
      `Land Turn of ${target}: ${holder ? describeHolder(holder, now) : "free"}.`,
    );
    console.log(
      state.waiters.length > 0
        ? `Land Queue of ${target}:\n${describeWaiters(state.waiters)}`
        : `Land Queue of ${target}: empty.`,
    );
  }
}

await yargs(hideBin(process.argv))
  .scriptName("land")
  .usage(
    "pnpm land [--to next|main [--hotfix]] [--wait <duration>]\npnpm land status",
  )
  .command(
    "$0",
    "land the current worktree",
    (y) =>
      y
        .option("to", {
          choices: ["next", "main"] as const,
          default: "next" as const,
          describe: "the branch to land into",
        })
        .option("hotfix", {
          type: "boolean",
          default: false,
          describe: "with --to main: land a task branch off main onto it",
        })
        .option("wait", {
          type: "string",
          describe: `how long to wait for the Land Turn (default ${formatDuration(LAND_WAIT_MS)})`,
        }),
    async (argv) => {
      await landCommand(argv.to, argv.hotfix, argv.wait);
    },
  )
  .command(
    "status",
    "show the holder of each Land Turn and the lands that wait",
    () => {},
    async () => {
      await status();
    },
  )
  .epilogue(epilogue)
  .strict()
  .version(false)
  .wrap(null)
  .fail((message, error) => {
    if (error) throw error;
    usage(message);
  })
  .parseAsync();
