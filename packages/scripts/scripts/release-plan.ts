#!/usr/bin/env node
import type { Product } from "#release/lines";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { PRODUCTS, releaseLine } from "#release/lines";
import { parseRemoteTags, planProduct } from "#release/plan";

const root = join(import.meta.dirname, "../../..");
const tags = parseRemoteTags(
  execFileSync("git", ["ls-remote", "--tags", "origin"], {
    cwd: root,
    encoding: "utf8",
  }),
);
let docsTag = "";
for (const product of Object.keys(PRODUCTS) as Product[]) {
  const { version } = JSON.parse(
    readFileSync(join(root, PRODUCTS[product].app, "package.json"), "utf8"),
  ) as { version: string };
  const plan = planProduct({ product, version, tags });
  console.error(`${product}: ${plan.reason}`);
  console.log(`${product}=${plan.publish}`);
  if (plan.publish && releaseLine(version) === "stable" && !docsTag) {
    docsTag = plan.tag;
  }
}
console.log(`docs-tag=${docsTag}`);
