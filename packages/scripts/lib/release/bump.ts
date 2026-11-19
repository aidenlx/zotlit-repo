// The version rules of `pnpm release`: which bumps a current version offers.
// Every release is a version commit on `main`, and the version alone picks the
// line (ADR 0097): a pre-release version ships on the beta line, any other
// version on the stable line.
import { inc, prerelease, valid } from "semver";

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
 * they make versions that do not follow from a pre-release.
 */
export function bumpOptions(
  current: string,
): { kind: BumpKind; version: string }[] {
  const hidden = new Set<BumpKind>(
    prerelease(current) !== null ? ["patch", "prepatch"] : [],
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
): string | null {
  const offered = bumpOptions(current).find(({ kind }) => kind === spec);
  return offered ? offered.version : valid(spec);
}
