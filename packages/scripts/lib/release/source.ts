import { diff, gt } from "semver";

import type { Product } from "./lines.ts";
import { PRODUCTS, releaseLine, releaseTag } from "./lines.ts";

const STABLE = /^\d+\.\d+\.\d+$/;

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

export type OffTrunkRelease =
  | {
      ok: true;
      baseTag: string;
    }
  | { ok: false; reason: string };

export function offTrunkRelease(options: {
  product: Product;
  version: string;
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
