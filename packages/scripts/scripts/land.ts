#!/usr/bin/env node

import { readFileSync } from "node:fs";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { $ } from "zx";

import { SOURCE_BRANCH } from "@zotlit/config/repositories";

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
import {
  land,
  LAND_ATTEMPTS,
  LAND_CI_CHECK,
  LAND_CI_WAIT_MS,
  LAND_GATES,
  LAND_RECORD_PATH,
  LAND_RECORD_SECTIONS,
  LAND_WAIT_MS,
  RECORD_PR_WORKFLOW,
} from "#land";
import { ghLandGitHub, githubRepository } from "#land-github";
import { landAdmission, landStateDir, landWaitLog } from "#land-queue";

const EXIT_USAGE = 2;
const GATE_TAIL = 40;

const epilogue = `A land holds the Land Turn while it fetches, rebases, runs the gate, and pushes, so one land at a time reaches ${SOURCE_BRANCH} on this machine, in the order the lands started. The gate cannot be skipped.

From a task branch with a clean tree, a record file, and a gh login that GitHub accepts (checked before the turn):
  fetch origin/${SOURCE_BRANCH}, rebase the branch onto it, run ${LAND_GATES.change.join(" ")}, push the branch to origin and open its record PR (or update the open one), wait for the "${LAND_CI_CHECK}" check of the PR head (pnpm verify --pr, ${RECORD_PR_WORKFLOW}), push HEAD to ${SOURCE_BRANCH} as a fast-forward. The wait prints the state of the check at each read and ends after ${formatDuration(LAND_CI_WAIT_MS)}; a check that does not pass fails the land with the link to the job, and ${SOURCE_BRANCH} stays as it was. A land again on the same head reads the same result, unless the job ran again from its link. When ${SOURCE_BRANCH} moved during the gate or the CI wait, the turn starts again from the fetch (${LAND_ATTEMPTS} attempts). Then the local ${SOURCE_BRANCH} moves; when GitHub shows the PR as merged, the task branch is deleted on origin.

Record file: ${LAND_RECORD_PATH} in the worktree. Its first line is "# <title>", the title of the PR; the rest is the PR body, with the sections ${LAND_RECORD_SECTIONS.map((name) => `"## ${name}"`).join(", ")}.

On a failure, land exits non-zero, names the failed step, and prints the path of the full log. The worktree stays on its branch with a clean tree: after a rebase conflict the branch is as it was; after a failed gate it is rebased onto the fetched ${SOURCE_BRANCH}, the tree to fix.

Exit codes:
  0    landed
  1    a step failed
  ${EXIT_USAGE}    usage error
  ${EXIT_ADMISSION_BLOCKED}   the turn did not come within --wait; blocked, not a failure

Lease: each output of a step renews the Land Turn. A turn whose commands print nothing for ${formatDuration(SILENCE_LIMIT_MS.childOutput)} ends, and so does one past ${formatDuration(MAX_LEASE_MS)} in total. Default wait: ${formatDuration(LAND_WAIT_MS)}.
State and logs: ${landStateDir()} (wait log ${landWaitLog()}).`;

function usage(message: string): never {
  console.error(`land: ${message}`);
  process.exit(EXIT_USAGE);
}

async function landCommand(wait: string | undefined) {
  let waitMs: number | undefined;
  if (wait !== undefined) {
    try {
      waitMs = parseDuration(wait);
    } catch (error) {
      usage((error as Error).message);
    }
  }
  const cwd = process.cwd();
  const origin = (
    await $({ cwd, quiet: true, nothrow: true })`git remote get-url origin`
  ).stdout;
  const repository = githubRepository(origin);
  if (!repository) usage(`origin is not a GitHub repository: ${origin.trim()}`);
  const result = await land({
    cwd,
    gate: LAND_GATES.change,
    github: ghLandGitHub(repository),
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
}

async function status() {
  const state = await readDesktopSlotStatus({ admission: landAdmission() });
  const now = Temporal.Now.instant().epochMilliseconds;
  const holder = state.holders[0];
  console.log(`Land Turn: ${holder ? describeHolder(holder, now) : "free"}.`);
  console.log(
    state.waiters.length > 0
      ? `Land Queue:\n${describeWaiters(state.waiters)}`
      : "Land Queue: empty.",
  );
}

await yargs(hideBin(process.argv))
  .scriptName("land")
  .usage("pnpm land [--wait <duration>]\npnpm land status")
  .command(
    "$0",
    `land the current worktree onto ${SOURCE_BRANCH}`,
    (y) =>
      y.option("wait", {
        type: "string",
        describe: `how long to wait for the Land Turn (default ${formatDuration(LAND_WAIT_MS)})`,
      }),
    async (argv) => {
      await landCommand(argv.wait);
    },
  )
  .command(
    "status",
    "show the holder of the Land Turn and the lands that wait",
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
