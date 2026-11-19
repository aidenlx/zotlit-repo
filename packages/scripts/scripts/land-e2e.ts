#!/usr/bin/env node

// The detached runner of the End-to-end Run after a land (lib/land-e2e.ts).
// `pnpm land` starts it; it waits for the End-to-end Turn, then runs the
// newest tip of `main` in its own checkout, so later work in any worktree
// leaves that run alone. It runs from the shared state directory, since the
// worktree that landed may be removed before the run ends.

import type { LandE2eDeps, LandE2eOutcome, LandE2eRun } from "#land-e2e";
import { spawn } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";

import { readDesktopPaint } from "#desktop-paint";
import { EXIT_ADMISSION_BLOCKED, EXIT_LEASE_ENDED } from "#desktop-slot";
import { runLandE2e } from "#land-e2e";

/** How long `pnpm e2e` waits for its Desktop Slot. */
const DESKTOP_WAIT = "1h";
const EXCERPT_LINES = 80;

/**
 * Run one command with its output in the log. Each output is a sign of
 * progress of the End-to-end Turn. The command leads its own process group,
 * which the end of the turn's Lease ends.
 */
function command(
  log: NodeJS.WritableStream,
  {
    cwd,
    argv: [name, ...args],
    env = {},
    progress,
    leaseEnded,
  }: {
    cwd: string;
    argv: readonly [string, ...string[]];
    env?: NodeJS.ProcessEnv;
    progress?: (what: string) => void;
    leaseEnded?: AbortSignal;
  },
): Promise<{ code: number; stdout: string }> {
  log.write(`\n$ ${[name, ...args].join(" ")}\n`);
  const what = `output of ${[name, ...args].slice(0, 2).join(" ")}`;
  return new Promise((resolve) => {
    if (leaseEnded?.aborted) {
      resolve({ code: EXIT_LEASE_ENDED, stdout: "" });
      return;
    }
    const posix = process.platform !== "win32";
    const child = spawn(name, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
      detached: posix,
    });
    const stop = () => {
      try {
        if (posix && child.pid !== undefined)
          process.kill(-child.pid, "SIGTERM");
        else child.kill("SIGTERM");
      } catch {
        // The group is gone.
      }
    };
    leaseEnded?.addEventListener("abort", stop, { once: true });
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk;
      log.write(chunk);
      progress?.(what);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      log.write(chunk);
      progress?.(what);
    });
    child.on("error", (error) => {
      log.write(`${error.message}\n`);
      resolve({ code: 127, stdout });
    });
    child.on("close", (code) => {
      leaseEnded?.removeEventListener("abort", stop);
      resolve({ code: code ?? 128, stdout });
    });
  });
}

async function run({
  request,
  logPath,
  checkout,
  progress,
  leaseEnded,
}: LandE2eRun): Promise<LandE2eOutcome> {
  const log = createWriteStream(logPath, { flags: "a" });
  try {
    const at = (cwd: string, ...argv: [string, ...string[]]) =>
      command(log, { cwd, argv, progress, leaseEnded });
    const stopped = (stage: string): LandE2eOutcome => ({
      outcome: "failed",
      stage: `${stage} (the End-to-end Turn ended: ${String(leaseEnded.reason)})`,
    });
    const checkedOut = existsSync(join(checkout, ".git"))
      ? (
          await at(
            checkout,
            "git",
            "checkout",
            "--detach",
            "--force",
            request.commit,
          )
        ).code === 0 && (await at(checkout, "git", "clean", "-ffd")).code === 0
      : (await at(request.repository, "git", "worktree", "prune")).code === 0 &&
        (
          await at(
            request.repository,
            "git",
            "worktree",
            "add",
            "--detach",
            "--force",
            checkout,
            request.commit,
          )
        ).code === 0;
    if (leaseEnded.aborted) return stopped("checkout");
    if (!checkedOut) return { outcome: "failed", stage: "checkout" };

    // The same bootstrap as a new worktree (.config/wt.toml pre-start).
    if (
      (await at(checkout, "mise", "trust")).code !== 0 ||
      (await at(checkout, "mise", "run", "init", request.repository)).code !== 0
    ) {
      return leaseEnded.aborted
        ? stopped("bootstrap")
        : { outcome: "failed", stage: "bootstrap" };
    }

    const status = await at(
      checkout,
      process.execPath,
      "packages/scripts/scripts/obsidian-vault.ts",
      "status",
    );
    if (!status.stdout.trim().startsWith("ready ")) {
      return {
        outcome: "skipped",
        reason: "no desktop Obsidian with the CLI answers on this machine",
      };
    }

    const e2e = await command(log, {
      cwd: checkout,
      argv: ["pnpm", "e2e"],
      env: {
        ZOTLIT_E2E_REQUIRED: "1",
        ZOTLIT_DESKTOP_WAIT: DESKTOP_WAIT,
      },
      progress,
      leaseEnded,
    });
    if (leaseEnded.aborted) return stopped("End-to-end Run");
    if (e2e.code === 0) return { outcome: "passed" };
    if (e2e.code === EXIT_ADMISSION_BLOCKED) {
      return {
        outcome: "blocked",
        reason: `no Desktop Slot within ${DESKTOP_WAIT}`,
      };
    }
    if (e2e.code === EXIT_LEASE_ENDED) {
      return {
        outcome: "failed",
        stage:
          "End-to-end Run (its Desktop Slot Lease ended; the log names how long the run was silent and its last progress)",
      };
    }
    return { outcome: "failed", stage: "End-to-end Run" };
  } finally {
    await new Promise((resolve) => log.end(resolve));
  }
}

const report: LandE2eDeps["report"] = async ({ run, range, stage }) => {
  const { request, logPath, checkout } = run;
  if (!request.issueRepository) return undefined;
  const sink = createWriteStream(logPath, { flags: "a" });
  const commits = await command(sink, {
    cwd: checkout,
    argv: ["git", "log", "--oneline", "--no-decorate", "-n", "50", range],
  });
  const excerpt = stripVTControlCharacters(await readFile(logPath, "utf8"))
    .trimEnd()
    .split("\n")
    .slice(-EXCERPT_LINES)
    .join("\n");
  const short = request.commit.slice(0, 12);
  const body = [
    `The End-to-end Run after a land failed at the ${stage} stage, on \`main\` at ${request.commit}.`,
    "",
    `Commit range: \`${range}\` (from the last tip that passed).`,
    "",
    "```text",
    commits.stdout.trim() || request.commit,
    "```",
    "",
    `The full log is on the machine that ran it: \`${logPath}\`. The last ${EXCERPT_LINES} lines:`,
    "",
    "```text",
    excerpt,
    "```",
  ].join("\n");
  const bodyPath = `${logPath}.issue.md`;
  await writeFile(bodyPath, body);
  const created = await command(sink, {
    cwd: checkout,
    argv: [
      "gh",
      "issue",
      "create",
      "--repo",
      request.issueRepository,
      "--label",
      "needs-triage",
      "--title",
      `End-to-end Run fails on main at ${short}`,
      "--body-file",
      bodyPath,
    ],
  });
  await new Promise((resolve) => sink.end(resolve));
  return created.code === 0 ? created.stdout.trim() : undefined;
};

await runLandE2e({ run, report, paint: readDesktopPaint });
