import type { PublishedPluginName } from "#shell/plugins";
// The publish of one Obsidian plugin version, from the source repository to
// npm and the publish repository (ADR 0095):
//
//   build ─▶ pack ─▶ npm ─▶ registry ─▶ shell ─▶ check ─▶ commit ─▶ push ─▶ source tag
//
//   build       the host app's production build, with the docs site of the line
//   pack        the bundle package, as the tarball npm publishes
//   npm         publish it, with the dist-tag of the line
//   registry    wait until the registry serves it
//   shell       generate the shell; pnpm resolves its lockfile from the registry
//   check       install the shell from its lockfile in a clean folder, build it,
//               and compare main.js and styles.css with the host app's build
//   commit      the shell commit on the line's branch of the publish repository
//   push        the commit and the version tag, in one atomic push; the tag
//               starts the publish repository's release workflow
//   source tag  the product's release tag in the source repository, on the
//               source commit
//
// Each step that reaches outside (npm, push, source tag) is injected, so the
// same code runs in release.yml, on the lead's machine, in the dry run and in
// the tests. Each step finds what an earlier run did and skips it: a version
// on npm with the same files, a tag in the publish repository on the same
// tree, a source tag on the same commit. A version on npm or a tag with other
// content stops the run, since a published version is not made again.
import { cp, mkdir, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { $ } from "zx";

import { SOURCE_REPOSITORY } from "@zotlit/config/repositories";

import { DOCS_SITE_URL, NPM_DIST_TAG, releaseLine } from "./lines.ts";
import { prepareShellCommit } from "./publish-repo.ts";
import type { PublishRepoOptions, ShellCommit } from "./publish-repo.ts";
import { NPM_REGISTRY } from "./registry.ts";
import type { Registry } from "./registry.ts";
import { tarballDifferences } from "./tarball.ts";

import {
  compareBuilds,
  describeBuilds,
  installAndBuild,
} from "#shell/build-check";
import { generateShell, lockShell, scopeRegistryNpmrc } from "#shell/generate";
import { BUNDLE_PACKAGE_DIR, PUBLISHED_PLUGINS } from "#shell/plugins";

/** The tags of the source repository: read, and push one. */
export interface SourceTags {
  /** The commit `tag` names, or undefined when there is no such tag. */
  get(tag: string): Promise<string | undefined>;
  push(tag: string, commit: string): Promise<void>;
}

export interface ObsidianPublish {
  workspaceRoot: string;
  plugin: PublishedPluginName;
  version: string;
  /** The source repository commit the release is built from. */
  sourceCommit: string;
  sourceTag: string;
  /** A folder of this run's files; its old content is removed. */
  workDir: string;
  /** The host app's production build, with `env` set. */
  build: (env: { DOCS_SITE_URL: string }) => Promise<void>;
  /** The registry the bundle package is published to and read from. */
  registry: Registry;
  publishPackage: (tarball: string, distTag: string) => Promise<void>;
  publishRepo: PublishRepoOptions;
  pushShell: (shell: ShellCommit) => Promise<void>;
  sourceTags: SourceTags;
  /** How long to wait for the registry to serve a new version. */
  registryWait?: { timeoutMs: number; intervalMs: number };
  /** The pause between two tries of a lockfile resolve. @default 30 s */
  lockRetryMs?: number;
  say: (line: string) => void;
}

export interface ObsidianPublished {
  tarball: string;
  shell: ShellCommit;
  shellDir: string;
}

/** The attempts of a lockfile resolve: the registry's mirrors can lag its API. */
const LOCK_ATTEMPTS = 3;

export async function publishObsidian(
  options: ObsidianPublish,
): Promise<ObsidianPublished> {
  const { workspaceRoot, version, workDir, registry, say } = options;
  const plugin = PUBLISHED_PLUGINS[options.plugin];
  const line = releaseLine(version);
  const appDir = join(workspaceRoot, plugin.app);
  const bundleDir = join(appDir, BUNDLE_PACKAGE_DIR);
  const step = (name: string) => say(`\n▸ ${name}`);
  await rm(workDir, { recursive: true, force: true });
  await mkdir(workDir, { recursive: true });

  step(`build: ${plugin.app}, docs site ${DOCS_SITE_URL[line]}`);
  await options.build({ DOCS_SITE_URL: DOCS_SITE_URL[line] });
  const built = JSON.parse(
    await readFile(join(bundleDir, "package.json"), "utf8"),
  ) as { name: string; version: string };
  if (built.name !== plugin.bundlePackage || built.version !== version) {
    throw new Error(
      `The build wrote ${built.name}@${built.version}, not ${plugin.bundlePackage}@${version}.`,
    );
  }

  step(`pack: ${plugin.bundlePackage}@${version}`);
  const packDir = join(workDir, "npm");
  await mkdir(packDir, { recursive: true });
  await $({
    cwd: bundleDir,
    quiet: true,
  })`pnpm pack --pack-destination ${packDir}`;
  const packed = (await readdir(packDir)).find((file) => file.endsWith(".tgz"));
  if (!packed) throw new Error(`pnpm pack wrote no tarball into ${packDir}.`);
  const tarball = join(packDir, packed);
  say(tarball);

  step(
    `npm: ${plugin.bundlePackage}@${version}, dist-tag ${NPM_DIST_TAG[line]}`,
  );
  const published = await registry.tarball(plugin.bundlePackage, version);
  if (published) {
    const differences = await tarballDifferences(
      published,
      await readFile(tarball),
      join(workDir, "compare"),
    );
    if (differences.length > 0) {
      throw new Error(
        `${registry.url} has ${plugin.bundlePackage}@${version} with other files than this build: ${differences.join(", ")}. A published version is not made again: release a new version.`,
      );
    }
    say(
      `${registry.url} has this version with the same files; it is not published again.`,
    );
  } else {
    await options.publishPackage(tarball, NPM_DIST_TAG[line]);
  }

  step(
    `registry: wait until ${registry.url} serves ${plugin.bundlePackage}@${version}`,
  );
  await registry.waitFor(plugin.bundlePackage, version, options.registryWait);

  const shellDir = join(workDir, "shell");
  step(`shell: generate into ${shellDir}, lockfile from ${registry.url}`);
  await generateShell({
    plugin: options.plugin,
    version,
    outDir: shellDir,
    workspaceRoot,
  });
  const standIn = registry.url === NPM_REGISTRY ? undefined : registry.url;
  for (let attempt = 1; ; attempt++) {
    try {
      await lockShell(shellDir, {
        plugin: options.plugin,
        ...(standIn ? { registry: standIn } : {}),
      });
      break;
    } catch (error) {
      if (attempt >= LOCK_ATTEMPTS) throw error;
      say(`The lockfile did not resolve (attempt ${attempt}); trying again.`);
      await delay(options.lockRetryMs ?? 30_000);
    }
  }

  const buildDir = join(workDir, "build");
  step(`check: frozen install and build in ${buildDir}`);
  await cp(shellDir, buildDir, { recursive: true });
  await installAndBuild(
    buildDir,
    standIn ? { npmrc: scopeRegistryNpmrc(options.plugin, standIn) } : {},
  );
  const builds = await compareBuilds(join(appDir, "dist"), buildDir);
  say(describeBuilds(builds));
  if (builds.some(({ app, shell }) => app !== shell)) {
    throw new Error(
      "The shell, installed from the registry, does not build the host app's main.js and styles.css.",
    );
  }

  step(`commit: the shell on ${options.publishRepo.remote}`);
  const shell = await prepareShellCommit({
    ...options.publishRepo,
    shellDir,
    version,
    line,
    message: `release: ${version}

The shell of ${plugin.bundlePackage}@${version}, generated from
${SOURCE_REPOSITORY}@${options.sourceCommit}.
`,
  });
  say(
    shell.state === "released"
      ? `The tag ${shell.tag} names this shell already, on ${shell.commit.slice(0, 12)}.`
      : `${shell.commit.slice(0, 12)} on ${shell.branch}, parents ${shell.parents.map((parent) => parent.slice(0, 12)).join(" ")}.`,
  );

  step(`push: ${shell.branch} and the tag ${shell.tag}`);
  if (shell.state === "released") {
    say("Pushed by an earlier run; nothing to push.");
  } else {
    await options.pushShell(shell);
  }

  step(
    `source tag: ${options.sourceTag} on ${options.sourceCommit.slice(0, 12)}`,
  );
  await pushSourceTag({
    tags: options.sourceTags,
    tag: options.sourceTag,
    commit: options.sourceCommit,
    say,
  });
  return { tarball, shell, shellDir };
}

/**
 * Pushes `tag` on `commit` to the source repository; skips a tag that names
 * `commit` already and stops at one that names another commit.
 */
export async function pushSourceTag({
  tags,
  tag,
  commit,
  say,
}: {
  tags: SourceTags;
  tag: string;
  commit: string;
  say: (line: string) => void;
}): Promise<void> {
  const tagged = await tags.get(tag);
  if (tagged === commit) {
    say(`The source repository has ${tag} on this commit already.`);
    return;
  }
  if (tagged) {
    throw new Error(
      `The source repository has ${tag} on ${tagged.slice(0, 12)}, not on ${commit.slice(0, 12)}. Move or delete it by hand if that tag is wrong.`,
    );
  }
  await tags.push(tag, commit);
}
