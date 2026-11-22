#!/usr/bin/env node

import type { GateHalf, GateStep } from "#gate-halves";
import { Effect } from "effect";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { $ } from "zx";

import {
  EXIT_ADMISSION_BLOCKED,
  MEMORY_GATE_ADMITTED_ENV,
  passMemoryGateOrExit,
} from "@zotlit/config/memory-gate";

import { affectedBase } from "#affected-base";
import { isAgentDocsOnly } from "#agent-docs";
import { EXIT_LEASE_ENDED } from "#desktop-slot";
import { gateSteps, halfOf } from "#gate-halves";
import {
  GATE_SHARD_FLAG,
  isLastShard,
  parseGateShard,
  shardTestArgs,
} from "#gate-shards";
import { getWorkspaceRoot } from "#package-roots";

const EXIT_USAGE = 2;
const { release, local, pr, shard } = await yargs(hideBin(process.argv))
  .scriptName("pnpm verify")
  .usage("$0 [--local | --pr [--shard <index>/<total>] | --release]")
  .version(false)
  .option("local", {
    type: "boolean",
    describe: `Only the half that runs before a push: ${gateSteps("local").join(", ")}`,
  })
  .option("pr", {
    type: "boolean",
    describe: `Only the half that runs on the record PR: ${gateSteps("pr").join(", ")}`,
  })
  .option("shard", {
    type: "string",
    describe: `With --pr: the tests of one shard, such as 1/3`,
    coerce: (value: string) => {
      const parsed = parseGateShard(value);
      if (!parsed)
        throw new Error(
          `${GATE_SHARD_FLAG} takes <index>/<total>, such as 1/3; it got ${JSON.stringify(value)}.`,
        );
      return parsed;
    },
  })
  .option("release", {
    type: "boolean",
    describe: "Every package, and the release checks",
  })
  .conflicts("local", ["pr", "release"])
  .conflicts("pr", "release")
  .implies("shard", "pr")
  .strict()
  .epilogue(
    `Without --release, the gate covers the packages that differ from the merge base with origin/main, and their dependents. A branch that changes only agent docs runs Format only.

A package's test task joins a shard before the last through the task tag ci-shard-<index> in its turbo.json. The last shard runs every other test task, the root test tasks and Bundle.

Exit codes:
  0    passed
  1    a step failed
  ${EXIT_USAGE}    usage error
  ${EXIT_ADMISSION_BLOCKED}   the Memory Gate did not admit the tests; blocked, not a failure
  ${EXIT_LEASE_ENDED}   the Lease of a run ended`,
  )
  .fail((message, error) => {
    console.error(`verify: ${message || error.message}`);
    process.exit(EXIT_USAGE);
  })
  .parseAsync();
const halves: readonly GateHalf[] = local
  ? ["local"]
  : pr
    ? ["pr"]
    : ["local", "pr"];
const ci = process.env.GITHUB_ACTIONS === "true";

const root = await getWorkspaceRoot(import.meta.dirname);
const base = release ? undefined : await affectedBase(root);
const scope = base ? ["--affected"] : [];
const env = base ? { ...process.env, TURBO_SCM_BASE: base } : process.env;
const sh = $({ cwd: root, stdio: "inherit", env });

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
  await releaseRuns();
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
  const last = !shard || isLastShard(shard);
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
    await gated`pnpm exec turbo run ${shardTestArgs(shard ?? { index: 1, total: 1 })} ${scope} --concurrency=${ci ? 1 : 2}`;
  });

  if (last) {
    await gateStep("Bundle", () => sh`pnpm check:bundle`);
  }
}

async function releaseRuns(): Promise<void> {
  await step("End-to-end Run", async () => {
    if (ci) {
      console.log("The End-to-end Run ran before publishing in pnpm release.");
      return;
    }
    await sh`pnpm e2e`;
    await sh`pnpm e2e:worker`;
  });
  await step("Start-up", async () => {
    if (ci) {
      console.log("The start-up gate is desktop-only and ran in pnpm release.");
      return;
    }
    await sh`pnpm --filter @zotlit/e2e measure:startup --check`;
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
