#!/usr/bin/env node

import type { GateHalf, GateStep } from "#gate-halves";
import { Effect } from "effect";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
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
import { GATE_HALF_FLAGS, halfOf } from "#gate-halves";
import { getWorkspaceRoot } from "#package-roots";

const release = process.argv.includes("--release");
const localHalf = process.argv.includes(GATE_HALF_FLAGS.local);
const prHalf = process.argv.includes(GATE_HALF_FLAGS.pr);
if ([release, localHalf, prHalf].filter(Boolean).length > 1) {
  console.error(
    `verify: pass one of --release, ${GATE_HALF_FLAGS.local} and ${GATE_HALF_FLAGS.pr}.`,
  );
  process.exit(2);
}
const halves: readonly GateHalf[] = localHalf
  ? ["local"]
  : prHalf
    ? ["pr"]
    : ["local", "pr"];
const ci = process.env.GITHUB_ACTIONS === "true";

const root = await getWorkspaceRoot(import.meta.dirname);
const base = release ? undefined : await affectedBase(root);
const scope = base ? ["--affected"] : [];
const env = base ? { ...process.env, TURBO_SCM_BASE: base } : process.env;
const sh = $({ cwd: root, stdio: "inherit", env });

if (release && !ci) await exitUnlessDesktopPaints();

await gateStep("Format", () => sh`pnpm exec oxfmt --check`);

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

await localSteps();
await ciSteps();

if (release) {
  await desktopChecks();
  await step("Obsidian guideline review", () => sh`pnpm review`);
  await step("Publish shell", () => sh`pnpm release:check-shell`);
}

async function localSteps(): Promise<void> {
  await gateStep("Generated artifacts", async () => {
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

  await gateStep(
    "Lint",
    () => sh`pnpm lint ${ci ? ["--", "-f", "github"] : []}`,
  );

  await gateStep(
    "Typecheck",
    () =>
      sh`pnpm exec turbo run typecheck typecheck:test typecheck:node --filter=!@zotlit/e2e ${scope}`,
  );

  await gateStep(
    "Snapshot size",
    () => sh`node packages/scripts/scripts/snapshot-size.ts`,
  );
}

async function ciSteps(): Promise<void> {
  await gateStep("Test", async () => {
    const admitted = await Effect.runPromise(passMemoryGateOrExit());
    const electron = ci ? {} : { ZOTLIT_TEST_ELECTRON_PATH: electronPath() };
    const gated = sh({
      env: {
        ...env,
        ...electron,
        ...(admitted ? { [MEMORY_GATE_ADMITTED_ENV]: "1" } : {}),
      },
    });
    await gated`pnpm exec turbo run test //#test:eval-runtime ${scope} --concurrency=${ci ? 1 : 2}`;
  });

  await gateStep("Bundle", () => sh`pnpm check:bundle`);
}

async function desktopChecks(): Promise<void> {
  await desktopRuns();
  await step("Start-up", async () => {
    if (ci) {
      console.log("The start-up gate is desktop-only and ran in pnpm release.");
      return;
    }
    await sh`pnpm --filter @zotlit/e2e measure:startup --check`;
  });
}

async function desktopRuns(): Promise<void> {
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
    slot?.progress("pnpm e2e starts");
    await sh({ env: { ...process.env, ZOTLIT_E2E_REQUIRED: "1" } })`pnpm e2e`;
    slot?.progress("pnpm e2e:worker starts");
    await sh({ env: { ...process.env } })`pnpm e2e:worker`;
  });
}

function electronPath(): string {
  const binary = process.env.ZOTLIT_TEST_ELECTRON_PATH ?? installedElectron();
  if (binary) return binary;
  throw new Error(
    "The Electron renderer tests need an Electron binary. Run `node node_modules/electron/install.js` in apps/obsidian, or set ZOTLIT_TEST_ELECTRON_PATH.",
  );
}

function installedElectron(): string | null {
  try {
    const binary: unknown = createRequire(
      join(root, "apps/obsidian/package.json"),
    )("electron");
    return typeof binary === "string" && existsSync(binary) ? binary : null;
  } catch {
    return null;
  }
}

async function gateStep(
  name: GateStep,
  run: () => Promise<unknown>,
): Promise<void> {
  if (halves.includes(halfOf(name))) await step(name, run);
}

async function step(name: string, run: () => Promise<unknown>): Promise<void> {
  console.log(`\n▸ ${name}`);
  try {
    await run();
  } catch (error) {
    if (error instanceof Error && !("exitCode" in error)) {
      console.error(error.message);
    }
    console.error(`\n✖ ${name} failed`);
    const code =
      error instanceof Error && "exitCode" in error ? error.exitCode : 1;
    process.exit(
      code === EXIT_ADMISSION_BLOCKED || code === EXIT_LEASE_ENDED ? code : 1,
    );
  }
}
