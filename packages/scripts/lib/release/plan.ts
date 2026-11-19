// Which products a push publishes. A product publishes when its version is on
// the line of the pushed branch and the source repository has no release tag
// for it yet. The source tag is the last step of each product's publish
// (lib/release/obsidian.ts, lib/release/zotero.ts), so a run that failed half
// way publishes again, and every step before the tag skips what is done.

import { releaseLine, releaseTag, SOURCE_BRANCH } from "./lines.ts";
import type { Product } from "./lines.ts";

export interface ProductPlan {
  product: Product;
  version: string;
  tag: string;
  publish: boolean;
  /** Why the product publishes or not, for the run's log. */
  reason: string;
}

export function planProduct(options: {
  product: Product;
  version: string;
  /** The pushed branch of the source repository. */
  branch: string;
  /** The tags of the source repository. */
  tags: ReadonlySet<string>;
}): ProductPlan {
  const { product, version, branch, tags } = options;
  const tag = releaseTag(product, version);
  const line = releaseLine(version);
  const plan = { product, version, tag };
  if (branch !== SOURCE_BRANCH[line]) {
    return {
      ...plan,
      publish: false,
      reason: `${version} is on the ${line} line, which publishes from ${SOURCE_BRANCH[line]}, not ${branch}.`,
    };
  }
  if (tags.has(tag)) {
    return { ...plan, publish: false, reason: `${tag} is released.` };
  }
  return { ...plan, publish: true, reason: `${tag} is not released yet.` };
}

/** The tag names in the output of `git ls-remote --tags`. */
export function parseRemoteTags(lsRemote: string): Set<string> {
  const tags = new Set<string>();
  for (const line of lsRemote.split("\n")) {
    const ref = line.split("\t")[1];
    if (!ref?.startsWith("refs/tags/")) continue;
    const name = ref.slice("refs/tags/".length);
    tags.add(name.endsWith("^{}") ? name.slice(0, -"^{}".length) : name);
  }
  return tags;
}
