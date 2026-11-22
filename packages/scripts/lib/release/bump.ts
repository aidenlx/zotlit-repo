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

export function resolveVersionSpec(
  current: string,
  spec: string,
): string | null {
  const offered = bumpOptions(current).find(({ kind }) => kind === spec);
  return offered ? offered.version : valid(spec);
}
