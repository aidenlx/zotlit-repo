import { PRODUCTS, releaseTag } from "./lines.ts";
import type { Product } from "./lines.ts";

export interface ProductPlan {
  product: Product;
  version: string;
  tag: string;
  publish: boolean;
  reason: string;
}

export function planProduct(options: {
  product: Product;
  version: string;
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
