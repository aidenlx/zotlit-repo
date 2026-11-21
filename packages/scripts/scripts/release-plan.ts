#!/usr/bin/env node
import type { Product } from "#release/lines";
// The plan job of release.yml: which products a push to `main` publishes.
//   node packages/scripts/scripts/release-plan.ts
// Prints `<product>=true|false` for each product of PRODUCTS (`obsidian`,
// `zotero`, `reader`, `resources`) on stdout, for
// $GITHUB_OUTPUT, and the reason for each on stderr. It also prints
// `docs-tag=<tag>`: the release tag of a stable version that this push
// publishes, from which the production docs site deploys; empty when the push
// publishes no stable version. It reads the app
// versions from the checkout and the tags from the remote `origin`.
//
// It runs before any dependency is installed, so it imports Node builtins
// and lib/release/{lines,plan}.ts alone.
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
  // Every product of a push tags the same commit, so any stable tag serves.
  if (plan.publish && releaseLine(version) === "stable" && !docsTag) {
    docsTag = plan.tag;
  }
}
console.log(`docs-tag=${docsTag}`);
