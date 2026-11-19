#!/usr/bin/env node
import type { Product } from "#release/lines";
// The plan job of release.yml: which products the pushed branch publishes.
//   node packages/scripts/scripts/release-plan.ts --branch <branch>
// Prints `obsidian=true|false` and `zotero=true|false` on stdout, for
// $GITHUB_OUTPUT, and the reason for each on stderr. It reads the app
// versions from the checkout and the tags from the remote `origin`.
//
// It runs before any dependency is installed, so it imports Node builtins
// and lib/release/{lines,plan}.ts alone.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { PRODUCTS } from "#release/lines";
import { parseRemoteTags, planProduct } from "#release/plan";

const { values } = parseArgs({ options: { branch: { type: "string" } } });
if (!values.branch) {
  console.error("--branch names the pushed branch of the source repository.");
  process.exit(2);
}
const root = join(import.meta.dirname, "../../..");
const tags = parseRemoteTags(
  execFileSync("git", ["ls-remote", "--tags", "origin"], {
    cwd: root,
    encoding: "utf8",
  }),
);
for (const product of Object.keys(PRODUCTS) as Product[]) {
  const { version } = JSON.parse(
    readFileSync(join(root, PRODUCTS[product].app, "package.json"), "utf8"),
  ) as { version: string };
  const plan = planProduct({ product, version, branch: values.branch, tags });
  console.error(`${product}: ${plan.reason}`);
  console.log(`${product}=${plan.publish}`);
}
