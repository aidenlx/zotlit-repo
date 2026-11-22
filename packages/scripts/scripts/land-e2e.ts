#!/usr/bin/env node

import type { LandE2eOutcome, LandE2eRun } from "#land-e2e";
import { spawn } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { join } from "node:path";

import { readDesktopPaint } from "#desktop-paint";
import { EXIT_ADMISSION_BLOCKED, EXIT_LEASE_ENDED } from "#desktop-slot";
import { githubE2eIssues } from "#e2e-issues";
import { landE2eDir, readLandE2eEvidence, runLandE2e } from "#land-e2e";

const DESKTOP_WAIT = "1h";

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

await runLandE2e({
  run,
  evidence: readLandE2eEvidence,
  issues: githubE2eIssues(landE2eDir()),
  paint: readDesktopPaint,
});
