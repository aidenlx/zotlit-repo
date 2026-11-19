// Which commit of the source repository a release may build. Every release is
// a version commit on `main`, the trunk (ADR 0097). A stable hotfix is the one
// release of a commit that `main` lacks: while `main` holds unfinished work,
// the fix goes on a local branch cut from the latest stable release tag, and
// its commits reach the remote through the release tag alone.
//
//   on origin/main                          beta or stable    publish
//   off origin/main, stable, a patch of     stable hotfix     publish
//     the latest stable release, and a
//     descendant of its tag
//   anything else                                             refuse

import { diff, gt } from "semver";

import { PRODUCTS, releaseLine, releaseTag } from "./lines.ts";
import type { Product } from "./lines.ts";

/** A stable version, `x.y.z`, with no pre-release part or build metadata. */
const STABLE = /^\d+\.\d+\.\d+$/;

/**
 * The newest stable version of `product` among the release tags `tags`: the
 * version of the latest stable release.
 */
export function latestStableVersion(
  product: Product,
  tags: Iterable<string>,
): string | undefined {
  const prefix = PRODUCTS[product].tagPrefix;
  let latest: string | undefined;
  for (const tag of tags) {
    if (!tag.startsWith(prefix)) continue;
    const version = tag.slice(prefix.length);
    if (!STABLE.test(version)) continue;
    if (latest === undefined || gt(version, latest)) latest = version;
  }
  return latest;
}

/** What a release of `version` from a commit that `main` lacks must be. */
export type OffTrunkRelease =
  | {
      ok: true;
      /** The release tag of the latest stable release, which HEAD descends from. */
      baseTag: string;
    }
  | { ok: false; reason: string };

/**
 * Whether `version` may publish as a stable hotfix: a stable version, greater
 * than the latest stable release and a patch of it. The caller checks that
 * HEAD descends from `baseTag`.
 */
export function offTrunkRelease(options: {
  product: Product;
  version: string;
  /** The release tags of the source repository. */
  tags: Iterable<string>;
}): OffTrunkRelease {
  const { product, version } = options;
  const refuse = (reason: string): OffTrunkRelease => ({
    ok: false,
    reason: `HEAD is not a commit of origin/main, and ${reason} A release builds a commit of main; a stable hotfix alone builds a branch cut from the latest stable release tag.`,
  });
  if (releaseLine(version) === "beta") {
    return refuse(`${version} is a pre-release.`);
  }
  const latest = latestStableVersion(product, options.tags);
  if (latest === undefined) {
    return refuse(`${product} has no stable release to patch.`);
  }
  if (!gt(version, latest) || diff(latest, version) !== "patch") {
    return refuse(
      `${version} is not a patch of the latest stable release ${latest}: a hotfix takes a greater version with the same major and minor.`,
    );
  }
  return { ok: true, baseTag: releaseTag(product, latest) };
}
