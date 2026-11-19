#!/usr/bin/env node
// `pnpm release:publish <obsidian|zotero>`: publishes the checked-out
// version of one product (lib/release/obsidian.ts, lib/release/zotero.ts).
// release.yml runs it for each product its plan job names; the lead runs the
// same command for a first publish, or to finish a run by hand. `--help`
// prints the contract.
import type { Product } from "#release/lines";
import type { PublishRepoOptions } from "#release/publish-repo";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { $ } from "zx";

import { RELEASE_REPOSITORY } from "@zotlit/config/repositories";

import { getWorkspaceRoot } from "#package-roots";
import { ghReleaseHost, gitSourceTags } from "#release/github";
import { PRODUCTS, releaseLine, SOURCE_BRANCH } from "#release/lines";
import { startLocalRegistry } from "#release/local-registry";
import { publishObsidian } from "#release/obsidian";
import { makeOutward } from "#release/outward";
import {
  githubTokenConfig,
  gitConfigEnv,
  pushShellCommit,
  releaseRefspecs,
} from "#release/publish-repo";
import { NPM_REGISTRY, Registry } from "#release/registry";
import { publishZotero } from "#release/zotero";

const root = await getWorkspaceRoot(import.meta.dirname);
const PUBLISH_URL = `https://github.com/${RELEASE_REPOSITORY}.git`;
/** The local stand-in of the publish repository in a dry run. */
const STAND_IN = join(root, ".scratch/publish-remote.git");

const epilogue = `Steps of obsidian: build, pack, npm, registry, shell, check, commit, push, source tag. Steps of zotero: build, release zt-<version>, update manifests, update channel, source tag. Each step skips what an earlier run finished, so a run that failed half way is run again as it is.

A real run publishes the version that apps/<app>/package.json names, from a clean checkout of a commit of the line's branch (${SOURCE_BRANCH.beta} for a beta, ${SOURCE_BRANCH.stable} for a stable version). Credentials:
  npm             trusted publishing in GitHub Actions (provenance); elsewhere the npm login
  ${RELEASE_REPOSITORY}  RELEASE_REPO_TOKEN when set; elsewhere the Git and gh login
  source tags     the remote origin of this checkout

--dry-run publishes nothing: npm publish becomes pnpm pack into a local registry, the publish repository becomes the bare clone ${STAND_IN} (cloned and refreshed from ${PUBLISH_URL}, read-only), and no tag is pushed. It prints each command a real run executes.`;

const argv = await yargs(hideBin(process.argv))
  .scriptName("release:publish")
  .version(false)
  .usage("pnpm release:publish <obsidian|zotero> [--dry-run [--version <v>]]")
  .demandCommand(1, "Name the product: obsidian or zotero.")
  .option("dry-run", {
    type: "boolean",
    default: false,
    describe: "replace every outward step with a local stand-in",
  })
  .option("version", {
    type: "string",
    describe:
      "with --dry-run: publish this version; package.json takes it for the run and gets its own back after",
  })
  .option("branch", {
    type: "string",
    describe:
      "the source branch the run publishes from (default: the checked-out branch)",
  })
  .epilogue(epilogue)
  .strict()
  .wrap(null)
  .parse();

const product = String(argv._[0]) as Product;
if (!(product in PRODUCTS)) {
  console.error(
    `release:publish: the product is obsidian or zotero, not ${product}.`,
  );
  process.exit(2);
}
const dryRun = argv.dryRun;
if (argv.version && !dryRun) {
  console.error(
    "release:publish: --version takes --dry-run; a real run publishes the committed version.",
  );
  process.exit(2);
}
const say = (line: string) => console.log(line);
const git = $({ cwd: root, quiet: true });
const appPackage = join(root, PRODUCTS[product].app, "package.json");
const committed = (
  JSON.parse(await readFile(appPackage, "utf8")) as { version: string }
).version;
const version = argv.version ?? committed;
const line = releaseLine(version);
const sourceCommit = (await git`git rev-parse HEAD`).stdout.trim();
const outward = makeOutward({ dryRun, say });

if ((await git`git status --porcelain`).stdout.trim()) {
  if (!dryRun) {
    console.error(
      "release:publish: the checkout has changes that are not committed. A release builds a commit.",
    );
    process.exit(1);
  }
  say(
    "The checkout has changes that are not committed; the dry run builds them.",
  );
}
const branch =
  argv.branch ?? (await git`git branch --show-current`).stdout.trim();
if (!dryRun) {
  if (branch !== SOURCE_BRANCH[line]) {
    console.error(
      `release:publish: ${version} is on the ${line} line, which publishes from ${SOURCE_BRANCH[line]}, not ${branch || "a detached HEAD"}.`,
    );
    process.exit(1);
  }
  await git`git fetch -q origin ${`+refs/heads/${branch}:refs/remotes/origin/${branch}`}`;
  if (
    (
      await git({
        nothrow: true,
      })`git merge-base --is-ancestor HEAD ${`origin/${branch}`}`
    ).exitCode !== 0
  ) {
    console.error(
      `release:publish: HEAD is not a commit of origin/${branch}. A release builds a commit that its branch has.`,
    );
    process.exit(1);
  }
}

say(
  `${dryRun ? "Dry run: " : ""}publish ${product} ${version} (${line} line) from ${sourceCommit.slice(0, 12)}.`,
);
say("release.yml runs the release gate before this: pnpm verify --release.");

await withVersion(appPackage, argv.version, async () => {
  if (product === "obsidian") await obsidian();
  else await zotero();
});

say(
  `\nThe commands of the outward steps${dryRun ? " that a real run executes" : ""}:`,
);
for (const command of outward.commands) say(`  ${command}`);

async function obsidian() {
  const token = process.env.RELEASE_REPO_TOKEN;
  const workDir = join(root, ".scratch/release-publish/obsidian");
  const local = dryRun ? await startLocalRegistry() : undefined;
  const publishRepo: PublishRepoOptions = dryRun
    ? {
        gitDir: join(workDir, "..", "publish-work.git"),
        remote: await refreshStandIn(),
      }
    : {
        gitDir: join(workDir, "..", "publish-work.git"),
        remote: PUBLISH_URL,
        ...(token ? { remoteConfig: githubTokenConfig(token) } : {}),
      };
  const ci = process.env.GITHUB_ACTIONS === "true";
  try {
    const result = await publishObsidian({
      workspaceRoot: root,
      plugin: "desktop",
      version,
      sourceCommit,
      workDir,
      build: async (env) => {
        await $({
          cwd: root,
          stdio: "inherit",
          env: { ...process.env, ...env },
        })`pnpm exec turbo run build --filter=@zotlit/obsidian`;
      },
      registry: new Registry(local?.url ?? NPM_REGISTRY),
      publishPackage: (tarball, distTag) =>
        outward.run({
          // Trusted publishing makes the provenance statement in GitHub
          // Actions; a publish from a machine has none to make.
          command: [
            "npm",
            "publish",
            tarball,
            "--access",
            "public",
            "--tag",
            distTag,
            ...(ci ? ["--provenance"] : []),
          ],
          cwd: workDir,
          standIn: () => local!.publish(tarball, distTag),
        }),
      publishRepo,
      pushShell: (shell) =>
        outward.run({
          command: [
            "git",
            "push",
            "--atomic",
            PUBLISH_URL,
            ...releaseRefspecs(shell),
          ],
          ...(token ? { env: gitConfigEnv(githubTokenConfig(token)) } : {}),
          run: () => pushShellCommit(publishRepo, shell),
          // The stand-in takes the branch; no tag goes anywhere in a dry run.
          standIn: () => pushShellCommit(publishRepo, shell, { tag: false }),
        }),
      sourceTags: gitSourceTags({ cwd: root, outward }),
      say,
    });
    if (dryRun) await reportDryRun(result.shell.branch, result.shell.commit);
  } finally {
    await local?.close();
  }
}

async function zotero() {
  const obsidianVersion = (
    JSON.parse(
      await readFile(join(root, PRODUCTS.obsidian.app, "package.json"), "utf8"),
    ) as { version: string }
  ).version;
  await publishZotero({
    workspaceRoot: root,
    version,
    changelogVersion: obsidianVersion,
    sourceCommit,
    build: async () => {
      await $({
        cwd: root,
        stdio: "inherit",
      })`pnpm exec turbo run build --filter=@zotlit/zotero`;
    },
    buildUpdateManifests: async () => {
      await $({
        cwd: root,
        stdio: "inherit",
      })`node apps/zotero/scripts/build-update-json.ts`;
    },
    host: ghReleaseHost({
      repo: RELEASE_REPOSITORY,
      outward,
      ...(process.env.RELEASE_REPO_TOKEN
        ? { token: process.env.RELEASE_REPO_TOKEN }
        : {}),
    }),
    sourceTags: gitSourceTags({ cwd: root, outward }),
    say,
  });
}

/**
 * The bare clone that stands in for the publish repository, with the
 * branches and tags the publish repository has now; a branch an earlier dry
 * run pushed is gone again.
 */
async function refreshStandIn(): Promise<string> {
  const exists =
    (
      await git({
        nothrow: true,
      })`git --git-dir ${STAND_IN} rev-parse --git-dir`
    ).exitCode === 0;
  if (!exists) {
    say(`Clone ${PUBLISH_URL} into ${STAND_IN} (read-only).`);
    await git`git clone -q --bare ${PUBLISH_URL} ${STAND_IN}`;
  }
  await git`git --git-dir ${STAND_IN} fetch -q --prune --prune-tags ${PUBLISH_URL} +refs/heads/*:refs/heads/* +refs/tags/*:refs/tags/*`;
  return STAND_IN;
}

async function reportDryRun(branch: string, commit: string) {
  const inStandIn = (...args: string[]) =>
    git`git --git-dir ${STAND_IN} ${args}`;
  say(`\n▸ The stand-in's ${branch} after the dry run`);
  say(
    (
      await inStandIn("log", "--graph", "--format=%h %s (%an)", "-4", branch)
    ).stdout.trimEnd(),
  );
  say(`\n▸ The tree of ${commit.slice(0, 12)}`);
  say(
    (
      await inStandIn(
        "ls-tree",
        "-r",
        "--format=%(objectmode) %(objectsize:padded) %(path)",
        commit,
      )
    ).stdout.trimEnd(),
  );
}

/**
 * Runs `run` with `version` in `path` (a package.json), then writes back the
 * file's own bytes, also when `run` fails or the run is stopped.
 */
async function withVersion(
  path: string,
  override: string | undefined,
  run: () => Promise<void>,
) {
  if (!override || override === committed) return run();
  const original = await readFile(path, "utf8");
  const pkg = JSON.parse(original) as { version: string };
  const restore = () => writeFile(path, original);
  const onSignal = () => {
    void restore().then(() => process.exit(130));
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  await writeFile(
    path,
    `${JSON.stringify({ ...pkg, version: override }, null, 2)}\n`,
  );
  say(`${path} names ${override} for this run.`);
  try {
    await run();
  } finally {
    await restore();
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }
}
