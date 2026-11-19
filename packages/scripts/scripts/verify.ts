#!/usr/bin/env node

import { Effect } from "effect";
// The one quality gate. `pnpm land` runs it on the rebased result before it
// pushes; GitHub runs no checks of its own (ADR 0076).
//   (no flag)   the packages the branch changed since it left `next` or
//               `main`, and their dependents.
//   --release   every package, the desktop End-to-end Run and worker check,
//               plus the Obsidian guideline review (ADR 0020) and the check
//               of the publish repository's shell (check-shell.ts).
//               `pnpm land --to main` runs it before it moves `main`,
//               `release.ts` in the Land Turn of the version commit, and
//               `release.yml` before it publishes (desktop checks skip there).
// A branch that changes only agent docs (lib/agent-docs.ts) runs Format only.
// Format, lint and the generated-artifact checks always cover the whole tree.
import { $ } from "zx";

import {
  EXIT_ADMISSION_BLOCKED,
  MEMORY_GATE_ADMITTED_ENV,
  passMemoryGateOrExit,
} from "@zotlit/config/memory-gate";

import { affectedBase } from "#affected-base";
import { isAgentDocsOnly } from "#agent-docs";
import { exitUnlessDesktopPaints } from "#desktop-paint";
import {
  acquireDesktopSlotOrExit,
  EXIT_LEASE_ENDED,
  SILENCE_LIMIT_MS,
} from "#desktop-slot";
import { getWorkspaceRoot } from "#package-roots";

const release = process.argv.includes("--release");
const ci = process.env.GITHUB_ACTIONS === "true";

const root = await getWorkspaceRoot(import.meta.dirname);
const base = release ? undefined : await affectedBase(root);
// `--affected` selects the tasks whose `inputs` changed since TURBO_SCM_BASE
// and the tasks that depend on them (`futureFlags` in turbo.json). Without a
// base, every package.
const scope = base ? ["--affected"] : [];
const env = base ? { ...process.env, TURBO_SCM_BASE: base } : process.env;
const sh = $({ cwd: root, stdio: "inherit", env });

// The desktop runs come last and need a painted window: a desktop that cannot
// paint stops the release gate now (exit 75), not after the other steps.
if (release && !ci) await exitUnlessDesktopPaints();

await step("Format", () => sh`pnpm exec oxfmt --check`);

// A branch that changes only agent docs stops here. The root lint and
// generated-artifact tasks run for every change, so a one-line doc fix would
// run them in full, and a slow gate teaches its bypass (ADR 0076).
if (base) {
  const changed = (
    await $({ cwd: root, quiet: true })`git diff --name-only ${base} HEAD`
  ).stdout
    .split("\n")
    .filter(Boolean);
  if (isAgentDocsOnly(changed)) {
    console.log("\nOnly agent docs changed, so the other checks skip.");
    process.exit(0);
  }
}

// The `zt` template contract and the template data page generate from TS
// sources (ADR 0015), and the Functions and methods page from the Query
// Schema of `@zotlit/item-query`, so a commit that changes the sources
// without the regenerated output fails here. Each generator is a Turbo task
// with declared inputs and outputs, so an unchanged source restores its
// output from the cache.
await step("Generated artifacts", async () => {
  await sh`pnpm exec turbo run @zotlit/db#generate:contract @zotlit/docs#generate:template-data @zotlit/docs#generate:query-functions`;
  const stale = (
    await $({
      cwd: root,
    })`git status --porcelain -- packages/db/src/contract/generated apps/docs/content/docs/reference/templates/data.mdx apps/docs/content/docs/reference/functions-and-methods.mdx`
  ).stdout.trim();
  if (stale) {
    throw new Error(
      `Regenerated output differs from the commit. Commit these files:\n${stale}`,
    );
  }
});

// `-f github` turns oxlint errors into inline annotations on the run.
await step("Lint", () => sh`pnpm lint ${ci ? ["--", "-f", "github"] : []}`);

// @zotlit/e2e stays out with the rest of the End-to-end Run.
await step(
  "Typecheck",
  () =>
    sh`pnpm exec turbo run typecheck typecheck:test typecheck:node --filter=!@zotlit/e2e ${scope}`,
);

await step(
  "Snapshot size",
  () => sh`node packages/scripts/scripts/snapshot-size.ts`,
);

// Each Vitest package runs its own worker pool, so a few packages at a time
// keep a starved worker from tripping its wall-clock timeout. The hosted
// runner has 4 vCPU: one package at a time there.
// The step passes the Memory Gate once; each package's Vitest then skips it.
await step("Test", async () => {
  const admitted = await Effect.runPromise(passMemoryGateOrExit());
  const gated = sh({
    env: admitted ? { ...env, [MEMORY_GATE_ADMITTED_ENV]: "1" } : env,
  });
  await gated`pnpm exec turbo run test ${scope} --concurrency=${ci ? 1 : 2}`;
  await gated`pnpm test:eval-runtime`;
});

if (release) {
  await desktopChecks();
  await step("Obsidian guideline review", () => sh`pnpm review`);
  // The publish repository's shell, built from the packed bundle package,
  // must reproduce the release build and pass the scanner's lint.
  await step("Publish shell", () => sh`pnpm release:check-shell`);
}

/**
 * One Desktop Slot hold covers both desktop runs: one wait in the Desktop
 * Queue and one Memory Gate pass, which the nested runs reuse through the
 * environment. Their test cases renew its Lease. At the Admission Deadline
 * this exits 75, outside `step`.
 */
async function desktopChecks(): Promise<void> {
  using slot = ci
    ? undefined
    : await acquireDesktopSlotOrExit({
        cwd: root,
        command: "pnpm verify --release",
        silenceMs: SILENCE_LIMIT_MS.e2e,
      });
  await step("End-to-end Run", async () => {
    if (ci) {
      console.log("End-to-end Run is desktop-only and ran in pnpm release.");
      return;
    }
    // The hold put its token and the Memory Gate mark in process.env.
    slot?.progress("pnpm e2e starts");
    await sh({ env: { ...process.env, ZOTLIT_E2E_REQUIRED: "1" } })`pnpm e2e`;
    slot?.progress("pnpm e2e:worker starts");
    await sh({ env: { ...process.env } })`pnpm e2e:worker`;
  });
}

async function step(name: string, run: () => Promise<unknown>): Promise<void> {
  console.log(`\n▸ ${name}`);
  try {
    await run();
  } catch (error) {
    // zx has already streamed the failed command's output.
    if (error instanceof Error && !("exitCode" in error)) {
      console.error(error.message);
    }
    console.error(`\n✖ ${name} failed`);
    // Blocked at admission, or the Lease ended: not a failure, so the caller
    // sees the same code the desktop run exited with.
    const code =
      error instanceof Error && "exitCode" in error ? error.exitCode : 1;
    process.exit(
      code === EXIT_ADMISSION_BLOCKED || code === EXIT_LEASE_ENDED ? code : 1,
    );
  }
}
