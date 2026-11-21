// The version rules of `pnpm release`: which bumps a current version offers.
// Every release is a version commit on `main`, and the version alone picks the
// line (ADR 0097): a pre-release version ships on the beta line, any other
// version on the stable line.
import { inc, prerelease, valid } from "semver";

import { releaseLine } from "./lines.ts";
import type { ReleaseLine } from "./lines.ts";

export type BumpKind =
  | "patch"
  | "minor"
  | "major"
  | "prepatch"
  | "preminor"
  | "premajor"
  | "prerelease";

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
 * The bumps offered for `current`, each with the version it makes. With a
 * pre-release current version, `patch` and `prepatch` are left out, since
 * they make versions that do not follow from a pre-release. With `line`, the
 * bumps onto that release line alone.
 */
export function bumpOptions(
  current: string,
  line?: ReleaseLine,
): { kind: BumpKind; version: string }[] {
  const hidden = new Set<BumpKind>(
    prerelease(current) !== null ? ["patch", "prepatch"] : [],
  );
  return ALL_KINDS.filter((kind) => !hidden.has(kind)).flatMap((kind) => {
    const version = inc(current, kind, preidOf(current));
    return version && (line === undefined || releaseLine(version) === line)
      ? [{ kind, version }]
      : [];
  });
}

/**
 * The Resource Pack's line follows the ZotLit release that builds it: a
 * version commit that releases both takes both versions on one line.
 *
 * @returns the message for versions on two lines; null when the lines agree,
 * or when the commit releases one of the two alone.
 */
export function lineConflict(next: {
  obsidian?: string;
  resources?: string;
}): string | null {
  const { obsidian, resources } = next;
  if (obsidian === undefined || resources === undefined) return null;
  const line = releaseLine(obsidian);
  if (releaseLine(resources) === line) return null;
  return `The Resource Pack version ${resources} is on the ${releaseLine(resources)} line, and the ZotLit version ${obsidian} is on the ${line} line. A release of both takes the pack on ZotLit's line: give the pack a ${line === "beta" ? "pre-release" : "stable"} version.`;
}

/**
 * A version spec from the command line: a bump that {@link bumpOptions}
 * offers, or an explicit semver version (normalized, so `v2.0.0` is
 * `2.0.0`). Null for anything else.
 */
export function resolveVersionSpec(
  current: string,
  spec: string,
): string | null {
  const offered = bumpOptions(current).find(({ kind }) => kind === spec);
  return offered ? offered.version : valid(spec);
}
