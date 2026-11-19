import type { LandOptions } from "#land";
import type { ReleaseBranch, ReleaseRoute } from "#release/bump";
import * as p from "@clack/prompts";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { prerelease, valid } from "semver";
import { $ } from "zx";

import { land, LAND_GATES } from "#land";
import { parseManifest as parseObsidianManifest } from "#obsidian-manifest";
import { getWorkspaceRoot } from "#package-roots";
import {
  bumpOptions,
  preidOf,
  releaseRoute,
  resolveVersionSpec,
} from "#release/bump";

/**
 * `pnpm release`: the version commit of a release, landed through the Land
 * Queue. It bumps `apps/{app}/package.json#version` (the one version source),
 * syncs the root manifest of a stable plugin release, refreshes the lockfile,
 * commits on a local release branch, and lands that commit. It tags nothing
 * and publishes nothing: `release.yml` publishes each version that its line's
 * branch gains (lib/release/plan.ts).
 *
 *   on next, pre-release   land into next with the release gate
 *   on next, stable        land into next, then graduate: main fast-forwards
 *                          to the version commit after the release gate
 *   on main, patch         land the hotfix onto main with the release gate
 *
 * The release gate (`pnpm verify --release`) runs once per release, in a Land
 * Turn, on the tree that is pushed. `--obsidian <bump|version>` and
 * `--zotero <bump|version>` name the apps and versions and run without
 * prompts. On a failure the release branch goes away and the checkout is back
 * on its branch; nothing reached the remote unless the output says so.
 *
 * @see CONTRIBUTING.md "Releasing"
 * @see docs/adr/0021-next-is-the-primary-branch.md
 */

const workspaceRoot = await getWorkspaceRoot(import.meta.dirname);

type AppName = "obsidian" | "zotero";

interface AppMeta {
  name: AppName;
  display: string;
  pkgPath: string;
}

const APPS: Record<AppName, AppMeta> = {
  obsidian: {
    name: "obsidian",
    display: "@zotlit/obsidian",
    pkgPath: join(workspaceRoot, "apps/obsidian/package.json"),
  },
  zotero: {
    name: "zotero",
    display: "@zotlit/zotero",
    pkgPath: join(workspaceRoot, "apps/zotero/package.json"),
  },
};

interface Bump {
  app: AppMeta;
  current: string;
  next: string;
}

const { values: flags } = parseArgs({
  options: {
    obsidian: { type: "string" },
    zotero: { type: "string" },
  },
});

/** Version specs named on the command line, by app. Any one of them turns prompts off. */
const requested: Partial<Record<AppName, string>> = {
  ...(flags.obsidian !== undefined && { obsidian: flags.obsidian }),
  ...(flags.zotero !== undefined && { zotero: flags.zotero }),
};
const interactive = Object.keys(requested).length === 0;
const git = $({ cwd: workspaceRoot, quiet: true });

p.intro(interactive ? "ZotLit release" : "ZotLit release (non-interactive)");

await assertCleanWorkingTree();
const branch = (await git`git branch --show-current`).stdout.trim();
if (branch !== "next" && branch !== "main") {
  fail(
    `Release from next (pre-releases and stable graduations) or main (hotfixes), not ${branch || "a detached HEAD"}.`,
  );
}
const releaseBranch: ReleaseBranch = branch;
await assertInSyncWithOrigin(releaseBranch);

const targets: AppMeta[] = interactive
  ? await pickApps()
  : (Object.keys(requested) as AppName[]).map((name) => APPS[name]);

const bumps: Bump[] = [];
for (const app of targets) {
  const current = (await readPackageJson(app.pkgPath)).version;
  const spec = requested[app.name];
  const next =
    spec === undefined
      ? await pickVersion(app, current)
      : resolveSpec(app, current, spec);
  if (next === null) cancel();
  bumps.push({ app, current, next });
}

const routed = releaseRoute(
  bumps.map((bump) => bump.next),
  releaseBranch,
  Object.keys(APPS).length,
);
if ("error" in routed) fail(routed.error);
const { route } = routed;
if (route === "graduation") await assertMainAncestry();

await completeRelease(route);

async function completeRelease(route: ReleaseRoute): Promise<void> {
  const summary = bumps.map((b) => `${b.app.name}@${b.next}`).join(", ");
  const plan = {
    beta: "land it into next with the release gate",
    graduation:
      "land it into next, then fast-forward main to it after the release gate",
    hotfix: "land it onto main with the release gate",
  }[route];
  if (!(await confirm(`Release ${summary}: commit the versions and ${plan}?`)))
    cancel();

  const releaseRef = `release/${releaseBranch}/${bumps.map((b) => `${b.app.name}-${b.next}`).join("+")}`;
  const stagedPaths = new Set<string>();
  const s = p.spinner();

  await git`git switch -q -c ${releaseRef}`;
  try {
    s.start("Bumping versions");
    for (const { app, next } of bumps) {
      await writePackageVersion(app.pkgPath, next);
      stagedPaths.add(app.pkgPath);
    }
    await syncObsidian(bumps, stagedPaths);
    s.stop("Versions bumped");

    s.start("Refreshing lockfile");
    await $({ cwd: workspaceRoot, quiet: true })`pnpm install --lockfile-only`;
    stagedPaths.add(join(workspaceRoot, "pnpm-lock.yaml"));
    s.stop("Lockfile refreshed");

    await git`git add ${[...stagedPaths]}`;
    await $({
      cwd: workspaceRoot,
      stdio: "inherit",
    })`git commit -q -m ${`chore: release ${summary}`}`;
  } catch (error) {
    await abandon(releaseRef);
    throw error;
  }

  const base: Omit<LandOptions, "to" | "gate"> = {
    cwd: workspaceRoot,
    say: (line) => p.log.message(line),
  };
  if (route === "beta") {
    p.log.step("Land into next with the release gate (pnpm verify --release)");
    await landOrFail(releaseRef, {
      ...base,
      to: "next",
      gate: LAND_GATES.main,
    });
  } else if (route === "hotfix") {
    p.log.step("Land onto main with the release gate (pnpm verify --release)");
    await landOrFail(releaseRef, {
      ...base,
      to: "main",
      hotfix: true,
      gate: LAND_GATES.main,
    });
  } else {
    p.log.step("Land into next (pnpm verify)");
    await landOrFail(releaseRef, {
      ...base,
      to: "next",
      gate: LAND_GATES.next,
    });
    p.log.step(
      "Graduate: fast-forward main to the version commit (pnpm verify --release)",
    );
    await landOrFail(
      releaseRef,
      { ...base, to: "main", gate: LAND_GATES.main },
      [
        "The version commit is on next; main did not move.",
        "Fix the failure on a task branch and land it into next, then graduate the new tip:",
        "  git switch --detach origin/next && pnpm land --to main",
      ],
    );
  }

  await returnTo(releaseRef);
  const publishes = route === "beta" ? "next" : "main";
  p.outro(
    `Landed ${summary}. release.yml publishes it from ${publishes}: the npm package, the shell and the tag in aidenlx/zotlit, and the release tags here.`,
  );
}

/** Lands the release branch; on a failure, explains, returns to the branch, and exits. */
async function landOrFail(
  releaseRef: string,
  options: LandOptions,
  afterFailure: readonly string[] = [],
): Promise<void> {
  const result = await land(options);
  if (result.ok) return;
  await abandon(releaseRef);
  fail(
    [
      `The land into ${options.to} failed at the ${result.step} step: ${result.message}`,
      `Full log: ${result.logPath}`,
      ...afterFailure,
    ].join("\n"),
    result.exitCode,
  );
}

/** Back to the branch the release started on, which the land moved; the release branch goes. */
async function returnTo(releaseRef: string): Promise<void> {
  await git`git switch -q ${releaseBranch}`;
  await git`git merge -q --ff-only ${`origin/${releaseBranch}`}`;
  await git`git branch -q -D ${releaseRef}`;
}

/** Drops the release branch and its version commit; the checkout is clean on its branch. */
async function abandon(releaseRef: string): Promise<void> {
  await git({ nothrow: true })`git reset -q --hard`;
  await git({ nothrow: true })`git switch -q ${releaseBranch}`;
  await git({ nothrow: true })`git branch -q -D ${releaseRef}`;
}

async function pickApps(): Promise<AppMeta[]> {
  const selection = await p.select({
    message: "Which app(s) to release?",
    options: [
      { value: "obsidian", label: "Obsidian (@zotlit/obsidian)" },
      { value: "zotero", label: "Zotero (@zotlit/zotero)" },
      { value: "both", label: "Both" },
    ] as const,
  });
  if (p.isCancel(selection)) cancel();
  return selection === "both"
    ? [APPS.obsidian, APPS.zotero]
    : [APPS[selection as AppName]];
}

/**
 * Interactive semver picker over {@link bumpOptions}, with `custom` as the
 * escape hatch.
 *
 * @returns the chosen version, or `null` if cancelled.
 */
async function pickVersion(
  app: AppMeta,
  current: string,
): Promise<string | null> {
  const options = [
    ...bumpOptions(current, releaseBranch).map(({ kind, version }) => ({
      value: version,
      label: `${kind} (${version})`,
    })),
    { value: "custom", label: "custom…" },
  ];
  const picked = await p.select({
    message: `New version for ${app.display} (current ${current}, pre-release id ${preidOf(current)})`,
    options,
  });
  if (p.isCancel(picked)) return null;
  if (picked !== "custom") return picked;
  const custom = await p.text({
    message: "Enter custom version",
    validate: (val) => (valid(val) ? undefined : "Invalid semver version"),
  });
  if (p.isCancel(custom)) return null;
  // Normalize: `valid()` also accepts noncanonical input like `v2.0.0`.
  return valid(custom);
}

/** A command-line version spec, resolved; exits on anything else. */
function resolveSpec(app: AppMeta, current: string, spec: string): string {
  const next = resolveVersionSpec(current, spec, releaseBranch);
  if (next === null) {
    const kinds = bumpOptions(current, releaseBranch).map(({ kind }) => kind);
    fail(
      `--${app.name} ${spec}: expected a semver version or one of ${kinds.join(", ")} (current ${current}).`,
    );
  }
  p.log.info(`${app.display}: ${current} → ${next}`);
  return next;
}

/** Asks `message`; without prompts, logs it and answers yes. */
async function confirm(message: string): Promise<boolean> {
  if (!interactive) {
    p.log.info(`${message} Yes (non-interactive).`);
    return true;
  }
  const answer = await p.confirm({ message });
  return !p.isCancel(answer) && answer;
}

/**
 * Obsidian community-store sync, applied on **stable** Obsidian releases only:
 * the root `manifest.json` and `versions.json`, which the shell generator
 * reads. Pre-releases leave both as they are.
 */
async function syncObsidian(
  releases: Bump[],
  staged: Set<string>,
): Promise<void> {
  const obsidian = releases.find((b) => b.app.name === "obsidian");
  if (!obsidian || prerelease(obsidian.next) !== null) return;

  const pkg = await readPackageJson(APPS.obsidian.pkgPath);
  pkg.version = obsidian.next;

  const manifest = parseObsidianManifest(pkg);
  const manifestPath = join(workspaceRoot, "manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  staged.add(manifestPath);

  const versionsPath = join(workspaceRoot, "versions.json");
  const versions = JSON.parse(await readFile(versionsPath, "utf-8")) as Record<
    string,
    string
  >;
  versions[manifest.version] = manifest.minAppVersion;
  await writeFile(versionsPath, `${JSON.stringify(versions, null, 2)}\n`);
  staged.add(versionsPath);
}

async function readPackageJson(
  path: string,
): Promise<Record<string, unknown> & { version: string }> {
  return JSON.parse(await readFile(path, "utf-8"));
}

async function writePackageVersion(
  path: string,
  version: string,
): Promise<void> {
  const pkg = await readPackageJson(path);
  pkg.version = version;
  await writeFile(path, `${JSON.stringify(pkg, null, 2)}\n`);
}

async function assertCleanWorkingTree(): Promise<void> {
  const status = (await git`git status --porcelain`).stdout.trim();
  if (status.length === 0) return;
  fail(`Working tree is not clean. Commit or stash changes first:\n${status}`);
}

/**
 * The release starts from the tip of `origin/${branch}`: a branch behind it
 * would bump a stale version, and commits only this checkout has reach the
 * remote through `pnpm land`, not inside a release.
 */
async function assertInSyncWithOrigin(branch: ReleaseBranch): Promise<void> {
  await git`git fetch -q origin ${`+refs/heads/${branch}:refs/remotes/origin/${branch}`}`;
  const counts = (
    await git`git rev-list --left-right --count ${`origin/${branch}...HEAD`}`
  ).stdout.trim();
  const [behind, ahead] = counts.split(/\s+/).map(Number) as [number, number];
  if (behind > 0 && ahead > 0) {
    fail(
      `${branch} has diverged from origin/${branch} (${ahead} ahead, ${behind} behind). Reconcile before releasing.`,
    );
  }
  if (behind > 0) {
    fail(
      `${branch} is ${behind} commit(s) behind origin/${branch}. Pull before releasing.`,
    );
  }
  if (ahead > 0) {
    fail(
      `${branch} has ${ahead} commit(s) that origin/${branch} lacks. Land them first: a release carries its version commit alone.`,
    );
  }
}

/**
 * Guards against regressing a hotfix that landed directly on `main`: a
 * graduation needs `origin/main` to be an ancestor of the commit it ships.
 */
async function assertMainAncestry(): Promise<void> {
  await git`git fetch -q origin +refs/heads/main:refs/remotes/origin/main`;
  const result = await git({
    nothrow: true,
  })`git merge-base --is-ancestor origin/main HEAD`;
  if (result.exitCode !== 0) {
    fail(
      "main has commits that next lacks. Land a branch that merges origin/main into next, then graduate.",
    );
  }
}

function fail(message: string, exitCode = 1): never {
  p.cancel(message);
  process.exit(exitCode);
}

function cancel(): never {
  p.cancel("Release cancelled.");
  process.exit(0);
}
