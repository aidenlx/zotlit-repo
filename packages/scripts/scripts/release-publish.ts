#!/usr/bin/env node
import type { Product } from "#release/lines";
import type { PublishRepoOptions } from "#release/publish-repo";
import type { PublishedPluginName } from "#shell/plugins";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { $ } from "zx";

import { RELEASE_REPOSITORY, SOURCE_BRANCH } from "@zotlit/config/repositories";

import { getWorkspaceRoot } from "#package-roots";
import { ghReleaseHost, gitSourceTags } from "#release/github";
import { PRODUCTS, releaseLine, releaseTag } from "#release/lines";
import { startLocalRegistry } from "#release/local-registry";
import { publishObsidian } from "#release/obsidian";
import { makeOutward } from "#release/outward";
import { parseRemoteTags } from "#release/plan";
import {
  githubTokenConfig,
  gitConfigEnv,
  pushShellCommit,
  releaseRefspecs,
} from "#release/publish-repo";
import { NPM_REGISTRY, Registry } from "#release/registry";
import { offTrunkRelease } from "#release/source";
import { publishZotero } from "#release/zotero";
import { PUBLISHED_PLUGINS } from "#shell/plugins";

const root = await getWorkspaceRoot(import.meta.dirname);
const PRODUCT_NAMES = Object.keys(PRODUCTS).join(", ");
const publishUrl = (plugin: PublishedPluginName) =>
  `https://github.com/${PUBLISHED_PLUGINS[plugin].repository}.git`;
const standInOf = (plugin: PublishedPluginName) =>
  join(root, `.scratch/publish-remote/${plugin}.git`);

const epilogue = `Steps of obsidian, reader and resources: build, pack, npm, registry, shell, check, commit, push, source tag. Steps of zotero: build, release zt-<version>, update manifests, update channel, source tag. Each step skips what an earlier run finished, so a run that failed half way is run again as it is.

A real run publishes the version that apps/<app>/package.json names, from a clean checkout of a commit of origin/${SOURCE_BRANCH}: a beta or a stable version. A stable hotfix publishes from a commit that origin/${SOURCE_BRANCH} lacks: its version is a patch of the latest stable release, greater than it, and HEAD descends from that release's tag. Credentials:
  npm             trusted publishing in GitHub Actions (provenance); elsewhere the npm login
  publish repos   RELEASE_REPO_TOKEN when set; elsewhere the Git and gh login
  source tags     the remote origin of this checkout

Publish repositories: obsidian ${PUBLISHED_PLUGINS.desktop.repository}, reader ${PUBLISHED_PLUGINS.reader.repository}, resources ${PUBLISHED_PLUGINS.resources.repository}, zotero ${RELEASE_REPOSITORY}. Source tags: obsidian <version>, zotero zt-<version>, reader reader-<version>, resources resources-<version>.

resources is the Resource Pack: its main.js holds the data files at byte offsets, so the build, the npm package and the shell copy it byte for byte, and the check compares main.js alone. Its version line is its own; its version picks its release line as for each product, and pnpm release holds that line to ZotLit's when one release carries both.

--dry-run publishes nothing: it reports the check of HEAD in place of refusing it, npm publish becomes pnpm pack into a local registry, a plugin's publish repository becomes the bare clone ${join(root, ".scratch/publish-remote/<plugin>.git")} (cloned and refreshed from the publish repository, read-only), and no tag is pushed. It prints each command a real run executes.`;

const argv = await yargs(hideBin(process.argv))
  .scriptName("release:publish")
  .version(false)
  .usage(
    "pnpm release:publish <obsidian|zotero|reader|resources> [--dry-run [--version <v>]]",
  )
  .demandCommand(1, `Name the product: ${PRODUCT_NAMES}.`)
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
  .epilogue(epilogue)
  .strict()
  .wrap(null)
  .parse();

const product = String(argv._[0]) as Product;
if (!(product in PRODUCTS)) {
  console.error(
    `release:publish: the product is one of ${PRODUCT_NAMES}, not ${product}.`,
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
const { name: appName, version: committed } = JSON.parse(
  await readFile(appPackage, "utf8"),
) as { name: string; version: string };
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
const source = await checkSource();
if (!source.ok) {
  if (!dryRun) {
    console.error(`release:publish: ${source.reason}`);
    process.exit(1);
  }
  say(`A real run refuses this HEAD: ${source.reason}`);
}

say(
  `${dryRun ? "Dry run: " : ""}publish ${product} ${version} (${line} line${source.ok && source.hotfix ? ", stable hotfix" : ""}) from ${sourceCommit.slice(0, 12)}.`,
);
say(
  source.ok && source.hotfix
    ? "A stable hotfix runs the release gate by hand before this: pnpm verify --release."
    : "release.yml runs the release gate before this: pnpm verify --release.",
);

await withVersion(appPackage, argv.version, async () => {
  const productInfo = PRODUCTS[product];
  if ("plugin" in productInfo) await obsidianPlugin(productInfo.plugin);
  else await zotero();
});

say(
  `\nThe commands of the outward steps${dryRun ? " that a real run executes" : ""}:`,
);
for (const command of outward.commands) say(`  ${command}`);
if (source.ok && source.hotfix) {
  say(
    "\nA stable hotfix publishes from this machine, so no workflow deploys its docs. Deploy the production docs site from its tag: gh workflow run docs-deploy.yml -f site=production",
  );
}

async function checkSource(): Promise<
  { ok: true; hotfix: boolean } | { ok: false; reason: string }
> {
  const ref = `refs/remotes/origin/${SOURCE_BRANCH}`;
  await git`git fetch -q origin ${`+refs/heads/${SOURCE_BRANCH}:${ref}`}`;
  const isAncestor = async (ancestor: string) =>
    (
      await git({
        nothrow: true,
      })`git merge-base --is-ancestor ${ancestor} HEAD`
    ).exitCode === 0;
  if (
    (await git({ nothrow: true })`git merge-base --is-ancestor HEAD ${ref}`)
      .exitCode === 0
  ) {
    return { ok: true, hotfix: false };
  }
  const tags = parseRemoteTags((await git`git ls-remote --tags origin`).stdout);
  const offTrunk = offTrunkRelease({ product, version, tags });
  if (!offTrunk.ok) return offTrunk;
  const { baseTag } = offTrunk;
  await git`git fetch -q --no-tags origin ${`+refs/tags/${baseTag}:refs/tags/${baseTag}`}`;
  if (!(await isAncestor(`refs/tags/${baseTag}`))) {
    return {
      ok: false,
      reason: `HEAD is not a commit of origin/${SOURCE_BRANCH}, and it does not descend from ${baseTag}, the latest stable release. Cut the hotfix branch from that tag.`,
    };
  }
  return { ok: true, hotfix: true };
}

async function obsidianPlugin(plugin: PublishedPluginName) {
  const token = process.env.RELEASE_REPO_TOKEN;
  const workDir = join(root, ".scratch/release-publish", product);
  const gitDir = join(workDir, "..", `${product}-publish-work.git`);
  const remoteUrl = publishUrl(plugin);
  const standIn = standInOf(plugin);
  const local = dryRun ? await startLocalRegistry() : undefined;
  const publishRepo: PublishRepoOptions = dryRun
    ? { gitDir, remote: await refreshStandIn(remoteUrl, standIn) }
    : {
        gitDir,
        remote: remoteUrl,
        ...(token ? { remoteConfig: githubTokenConfig(token) } : {}),
      };
  const ci = process.env.GITHUB_ACTIONS === "true";
  try {
    const result = await publishObsidian({
      workspaceRoot: root,
      plugin,
      version,
      sourceCommit,
      sourceTag: releaseTag(product, version),
      workDir,
      build: async (env) => {
        await $({
          cwd: root,
          stdio: "inherit",
          env: { ...process.env, ...env },
        })`pnpm exec turbo run build --filter=${appName}`;
      },
      registry: new Registry(local?.url ?? NPM_REGISTRY),
      publishPackage: (tarball, distTag) =>
        outward.run({
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
            remoteUrl,
            ...releaseRefspecs(shell),
          ],
          ...(token ? { env: gitConfigEnv(githubTokenConfig(token)) } : {}),
          run: () => pushShellCommit(publishRepo, shell),
          standIn: () => pushShellCommit(publishRepo, shell, { tag: false }),
        }),
      sourceTags: gitSourceTags({ cwd: root, outward }),
      say,
    });
    if (dryRun) {
      await reportDryRun(standIn, result.shell.branch, result.shell.commit);
    }
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

async function refreshStandIn(
  remoteUrl: string,
  standIn: string,
): Promise<string> {
  const exists =
    (
      await git({
        nothrow: true,
      })`git --git-dir ${standIn} rev-parse --git-dir`
    ).exitCode === 0;
  if (!exists) {
    say(`Clone ${remoteUrl} into ${standIn} (read-only).`);
    await git`git clone -q --bare ${remoteUrl} ${standIn}`;
  }
  await git`git --git-dir ${standIn} fetch -q --prune --prune-tags ${remoteUrl} +refs/heads/*:refs/heads/* +refs/tags/*:refs/tags/*`;
  return standIn;
}

async function reportDryRun(standIn: string, branch: string, commit: string) {
  const inStandIn = (...args: string[]) =>
    git`git --git-dir ${standIn} ${args}`;
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
