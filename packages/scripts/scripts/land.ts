#!/usr/bin/env node

import { readFileSync } from "node:fs";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { $ } from "zx";

import { SOURCE_BRANCH } from "@zotlit/config/repositories";

import { CONVENTIONAL_FORMAT } from "#conventional-commit";
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
  formatLandDiagnostic,
  formatLandFailure,
  land,
  LAND_AFTER_CI_WAIT_MS,
  LAND_ATTEMPTS,
  LAND_CI_CHECK,
  LAND_CI_WAIT_MS,
  LAND_GATES,
  LAND_INSTALL,
  LAND_PR_PATH,
  LAND_RECORD_PATH,
  LAND_RECORD_SECTIONS,
  LAND_WAIT_MS,
  LAND_WORKFLOW,
  RECORD_PR_WORKFLOW,
} from "#land";
import { ghLandGitHub, githubRepository } from "#land-github";
import { landAdmission, landStateDir, landWaitLog } from "#land-queue";

const EXIT_USAGE = 2;
const GATE_TAIL = 40;

const epilogue = `A land holds the Land Turn while it fetches, rebases, installs, runs the gate, and pushes, so one land at a time reaches ${SOURCE_BRANCH} on this machine, in the order the lands started. While it waits for the Land Turn, a land exits early if it finds a conflict with ${SOURCE_BRANCH}. --no-verify skips the gate; the CI check of the record PR still runs. --no-ci lands without that check: the land does not wait for it, and the landing workflow does not require it. Give both to skip every check.

From a task branch with a clean tree, a record file, and a gh login that GitHub accepts (checked before the turn):
  fetch origin/${SOURCE_BRANCH}, rebase the branch onto it, run ${LAND_INSTALL.join(" ")} when the rebase changed pnpm-lock.yaml, pnpm-workspace.yaml, or a package.json, run ${LAND_GATES.change.join(" ")}, push the branch to origin and open its record PR (or update the open one), wait for the "${LAND_CI_CHECK}" check of the PR head (pnpm verify --pr, ${RECORD_PR_WORKFLOW}), dispatch the trusted landing workflow to fast-forward ${SOURCE_BRANCH} to the checked head. The wait prints the state of the check at each read and ends after ${formatDuration(LAND_CI_WAIT_MS)}; a check that does not pass fails the land with the link to the job, and ${SOURCE_BRANCH} stays as it was. A land again on the same head reads the same result, unless the job ran again from its link. When ${SOURCE_BRANCH} moved during the gate or the CI wait, the turn starts again from the fetch (${LAND_ATTEMPTS} attempts). Then the local ${SOURCE_BRANCH} moves; when GitHub shows the PR as merged, the task branch is deleted on origin.

--after-ci is for a session whose GitHub token can push the branch and open the record PR but cannot dispatch workflows, such as a cloud agent. It marks a new record PR in its body, and ${LAND_WORKFLOW} lands a marked PR when its "${LAND_CI_CHECK}" check passes, with the same checks as a dispatch. The land then waits up to ${formatDuration(LAND_AFTER_CI_WAIT_MS)} for ${SOURCE_BRANCH} to reach the head. When GitHub refuses such a token the PR write, the land writes the title and body of the record PR to ${LAND_PR_PATH} and exits at the record step. Open the PR with the PR tool of the host, then land again: an open record PR whose title and body match the record stays as it is.

--draft is for a change that the maintainer reviews before it lands. It runs the same steps up to the record PR, opens or updates that PR as a draft, and stops: it does not wait for CI and ${SOURCE_BRANCH} stays as it was. Run it again to update the draft. A land without --draft on that branch marks the PR ready for review and lands it.

Record file: ${LAND_RECORD_PATH} in the worktree. Its first line is "# <title>", the title of the PR and, for a squash land, the subject of the commit, so a Conventional Commits subject (${CONVENTIONAL_FORMAT}); the rest is the PR body, with the sections ${LAND_RECORD_SECTIONS.map((name) => `"## ${name}"`).join(", ")}.

On a failure, land exits non-zero and prints "error[<step>]: <message>" (or "blocked[queue]" when the turn did not come), the path of the full log, "note" lines on the state of the branch, and a "help" line with the next action. The worktree stays on its branch with a clean tree: after a rebase conflict the branch is as it was; after a failed install or gate it is rebased onto the fetched ${SOURCE_BRANCH}, the tree to fix.

Exit codes:
  0    landed; with --draft, the draft record PR is open and ${SOURCE_BRANCH} is unchanged
  1    a step failed
  ${EXIT_USAGE}    usage error
  ${EXIT_ADMISSION_BLOCKED}   the turn did not come within --wait; blocked, not a failure

Lease: each output of a step renews the Land Turn. A turn whose commands print nothing for ${formatDuration(SILENCE_LIMIT_MS.childOutput)} ends, and so does one past ${formatDuration(MAX_LEASE_MS)} in total. Default wait: ${formatDuration(LAND_WAIT_MS)}.
State and logs: ${landStateDir()} (wait log ${landWaitLog()}).`;

const USAGE_HELP = "Run pnpm land --help for the flags and their values.";

function usage(message: string, help = USAGE_HELP): never {
  console.error(
    formatLandDiagnostic({ label: "error", code: "usage", message, help }),
  );
  process.exit(EXIT_USAGE);
}

async function landCommand({
  wait,
  verify,
  squash,
  afterCi,
  draft,
  ci,
}: {
  wait?: string | undefined;
  verify: boolean;
  ci: boolean;
  squash: boolean;
  afterCi: boolean;
  draft: boolean;
}) {
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
  if (!repository) {
    usage(
      `origin is not a GitHub repository: ${origin.trim()}`,
      "Land from a clone whose origin is the GitHub repository (git remote get-url origin).",
    );
  }
  const result = await land({
    cwd,
    squash,
    afterCi,
    draft,
    ...(ci ? {} : { skipCi: true }),
    ...(verify ? { gate: LAND_GATES.change } : {}),
    github: ghLandGitHub(repository),
    ...(waitMs === undefined ? {} : { waitMs }),
  });
  if (!result.ok) {
    if (result.step === "install" || result.step === "gate") {
      const tail = readFileSync(result.logPath, "utf8")
        .trimEnd()
        .split("\n")
        .slice(-GATE_TAIL)
        .join("\n");
      console.error(`\n${tail}\n`);
    }
    console.error(`\n${formatLandFailure(result)}`);
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
  .usage(
    "pnpm land [--wait <duration>] [--no-verify] [--no-ci] [--no-squash] [--after-ci] [--draft]\npnpm land status",
  )
  .command(
    "$0",
    `land the current worktree onto ${SOURCE_BRANCH}`,
    (y) =>
      y
        .option("squash", {
          type: "boolean",
          default: true,
          describe:
            "create one commit from the land record before verification; --no-squash preserves the rebased commits, each with a Conventional Commits subject",
        })
        .option("wait", {
          type: "string",
          describe: `how long to wait for the Land Turn (default ${formatDuration(LAND_WAIT_MS)})`,
        })
        .option("after-ci", {
          type: "boolean",
          default: false,
          describe: `let ${LAND_WORKFLOW} land the record PR when its CI check passes, and wait for ${SOURCE_BRANCH} to move; for a GitHub token that cannot dispatch workflows`,
        })
        .option("draft", {
          type: "boolean",
          default: false,
          describe: `open the record PR as a draft after the gate, and stop; ${SOURCE_BRANCH} stays as it was`,
        })
        .option("verify", {
          type: "boolean",
          default: true,
          describe: `run the gate (${LAND_GATES.change.join(" ")}); --no-verify skips it, and the CI check still runs`,
        })
        .option("ci", {
          type: "boolean",
          default: true,
          describe: `wait for the "${LAND_CI_CHECK}" check of the record PR and require it to pass; --no-ci lands without it`,
        }),
    async (argv) => {
      await landCommand(argv);
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
    if (message.startsWith("Unknown argument")) {
      usage(
        message,
        `When origin/${SOURCE_BRANCH} has this flag, this branch has an older pnpm land. Rebase the branch onto origin/${SOURCE_BRANCH} (git fetch origin && git rebase origin/${SOURCE_BRANCH}), then land again. Otherwise, ${USAGE_HELP.charAt(0).toLowerCase()}${USAGE_HELP.slice(1)}`,
      );
    }
    usage(message);
  })
  .parseAsync();
