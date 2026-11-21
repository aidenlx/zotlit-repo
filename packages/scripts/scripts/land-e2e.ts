#!/usr/bin/env node

// The detached runner of the End-to-end Run after a land (lib/land-e2e.ts).
// `pnpm land` starts it; it waits for the End-to-end Turn, then runs the
// newest tip of `main` in its own checkout, so later work in any worktree
// leaves that run alone. It runs from the shared state directory, since the
// worktree that landed may be removed before the run ends.

import type {
  LandE2eDeps,
  LandE2eIssue,
  LandE2eOutcome,
  LandE2eRun,
} from "#land-e2e";
import { spawn } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";

import { readDesktopPaint } from "#desktop-paint";
import { EXIT_ADMISSION_BLOCKED, EXIT_LEASE_ENDED } from "#desktop-slot";
import { landE2eDir, runLandE2e } from "#land-e2e";

/** How long `pnpm e2e` waits for its Desktop Slot. */
const DESKTOP_WAIT = "1h";

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

const evidence: LandE2eDeps["evidence"] = async ({ run, range }) => {
  const { logPath, checkout } = run;
  // Read the log before `git log` writes to it, so its end is the run's.
  const log = stripVTControlCharacters(await readFile(logPath, "utf8"));
  const sink = createWriteStream(logPath, { flags: "a" });
  const commits = await command(sink, {
    cwd: checkout,
    argv: ["git", "log", "--oneline", "--no-decorate", "-n", "50", range],
  });
  await new Promise((resolve) => sink.end(resolve));
  return { commits: commits.stdout, log };
};

/** Run `gh` in the state directory; its output goes to the runner's log. */
async function gh(...args: [string, ...string[]]): Promise<string> {
  const { code, stdout } = await command(process.stderr, {
    cwd: landE2eDir(),
    argv: ["gh", ...args],
  });
  if (code !== 0) {
    throw new Error(`gh ${args.slice(0, 2).join(" ")} exited ${code}`);
  }
  return stdout;
}

/** Write an issue body to a file for `gh --body-file`. */
async function bodyFile(body: string): Promise<string> {
  const path = join(landE2eDir(), "issue-body.md");
  await writeFile(path, body);
  return path;
}

const issues: LandE2eDeps["issues"] = {
  listOpen: async (repository, title) =>
    JSON.parse(
      await gh(
        "issue",
        "list",
        "--repo",
        repository,
        "--state",
        "open",
        "--search",
        `"${title}" in:title`,
        "--json",
        "number,title,url",
        "--limit",
        "100",
      ),
    ) as LandE2eIssue[],
  create: async (repository, { title, body, label }) =>
    (
      await gh(
        "issue",
        "create",
        "--repo",
        repository,
        "--label",
        label,
        "--title",
        title,
        "--body-file",
        await bodyFile(body),
      )
    ).trim(),
  comment: async (repository, number, body) => {
    await gh(
      "issue",
      "comment",
      String(number),
      "--repo",
      repository,
      "--body-file",
      await bodyFile(body),
    );
  },
};

await runLandE2e({ run, evidence, issues, paint: readDesktopPaint });
