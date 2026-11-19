// The version rules of `pnpm release` (ADR 0021): which bumps each branch
// offers, and which route a set of new versions takes to its line.
//
//   on next, pre-release versions   beta        land into next, release gate
//   on next, stable versions        graduation  land into next, then main
//                                               fast-forwards to that commit
//   on main, stable patch versions  hotfix      land onto main, release gate
import { inc, prerelease, valid } from "semver";

export type BumpKind =
  | "patch"
  | "minor"
  | "major"
  | "prepatch"
  | "preminor"
  | "premajor"
  | "prerelease";

/** The branches a release starts from. */
export type ReleaseBranch = "next" | "main";

/** The pre-release identifier a bump of `current` keeps: `beta` by default. */
export function preidOf(current: string): string {
  return prerelease(current)?.[0]?.toString() ?? "beta";
}

const ALL_KINDS: readonly BumpKind[] = [
  "patch",
  "minor",
  "major",
  "prepatch",
  "preminor",
  "premajor",
  "prerelease",
];

/**
 * The bumps offered for `current` on `branch`, each with the version it
 * makes. On `main`, `patch` alone: the hotfix path. On `next` with a
 * pre-release current version, `patch` and `prepatch` are left out, since
 * they make versions that do not follow from a pre-release.
 */
export function bumpOptions(
  current: string,
  branch: ReleaseBranch,
): { kind: BumpKind; version: string }[] {
  const hidden = new Set<BumpKind>(
    branch === "main"
      ? ALL_KINDS.filter((kind) => kind !== "patch")
      : prerelease(current) !== null
        ? ["patch", "prepatch"]
        : [],
  );
  return ALL_KINDS.filter((kind) => !hidden.has(kind)).flatMap((kind) => {
    const version = inc(current, kind, preidOf(current));
    return version ? [{ kind, version }] : [];
  });
}

/**
 * A version spec from the command line: a bump that {@link bumpOptions}
 * offers, or an explicit semver version (normalized, so `v2.0.0` is
 * `2.0.0`). Null for anything else.
 */
export function resolveVersionSpec(
  current: string,
  spec: string,
  branch: ReleaseBranch,
): string | null {
  const offered = bumpOptions(current, branch).find(
    ({ kind }) => kind === spec,
  );
  return offered ? offered.version : valid(spec);
}

export type ReleaseRoute = "beta" | "graduation" | "hotfix";

/**
 * The route of a release of `versions` from `branch`, or the rule it breaks.
 * @param appCount how many apps the workspace releases; a graduation takes all.
 */
export function releaseRoute(
  versions: readonly string[],
  branch: ReleaseBranch,
  appCount: number,
): { route: ReleaseRoute } | { error: string } {
  const stable = versions.filter((version) => prerelease(version) === null);
  if (branch === "main") {
    return stable.length === versions.length
      ? { route: "hotfix" }
      : {
          error:
            "main takes stable versions only: a hotfix is a patch release.",
        };
  }
  if (stable.length === 0) return { route: "beta" };
  if (stable.length < versions.length) {
    return {
      error:
        "Cannot mix stable and pre-release versions from next: all apps graduate together, or all stay on pre-release.",
    };
  }
  if (versions.length < appCount) {
    return {
      error:
        "A stable release from next takes every app: select Both, or pass both --obsidian and --zotero.",
    };
  }
  return { route: "graduation" };
}
