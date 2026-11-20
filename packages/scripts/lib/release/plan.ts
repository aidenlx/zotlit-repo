// Which products a push to `main` publishes. A product publishes when its
// `publish` switch in PRODUCTS is on and the source repository has no release
// tag for its version yet; the version picks
// its line (lib/release/lines.ts). The source tag is the last step of each product's publish
// (lib/release/obsidian.ts, lib/release/zotero.ts), so a run that failed half
// way publishes again, and every step before the tag skips what is done.

import { PRODUCTS, releaseTag } from "./lines.ts";
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
  /** The tags of the source repository. */
  tags: ReadonlySet<string>;
}): ProductPlan {
  const { product, version, tags } = options;
  const tag = releaseTag(product, version);
  const plan = { product, version, tag };
  if (!PRODUCTS[product].publish) {
    return {
      ...plan,
      publish: false,
      reason: `${product} has its publish switch off.`,
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
