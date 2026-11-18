#!/usr/bin/env node
// Holds the three plugin-package lists that a static file must spell out to
// what `pluginPackages` derives from the host's dependencies: the Tailwind
// `@source` lines of the host's stylesheet, the inputs of the
// `//#review:plugin` task in turbo.json, and the include list of the review
// program's tsconfig. The build, test and review configs read the derived
// list itself.
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { getWorkspaceRoot } from "#package-roots";
import { pluginPackages } from "#plugin-packages";

const root = await getWorkspaceRoot(import.meta.dirname);
const host = join(root, "apps/obsidian");
const sources = pluginPackages(host).map(
  ({ root: dir }) => `${relative(root, dir)}/src`,
);

const errors: string[] = [];
const compare = (where: string, listed: readonly string[]) => {
  const missing = sources.filter((source) => !listed.includes(source));
  const extra = listed.filter((source) => !sources.includes(source));
  if (missing.length > 0) errors.push(`${where} misses ${missing.join(", ")}`);
  if (extra.length > 0)
    errors.push(
      `${where} names ${extra.join(", ")}, which the host does not bundle`,
    );
};

const stylesheet = join(host, "src/zt-main.css");
const cssSources = [
  ...readFileSync(stylesheet, "utf8").matchAll(/^@source "([^"]+)";$/gm),
].map(([, path]) => relative(root, join(host, "src", path!)));
compare(relative(root, stylesheet), cssSources);

const turbo = JSON.parse(readFileSync(join(root, "turbo.json"), "utf8")) as {
  tasks: Record<string, { inputs?: string[] }>;
};
const inputs = turbo.tasks["//#review:plugin"]?.inputs ?? [];
const reviewSources = inputs
  .filter((input) => input.startsWith("packages/") && input.endsWith("/src/**"))
  .map((input) => input.slice(0, -"/**".length));
compare("turbo.json //#review:plugin inputs", reviewSources);
for (const source of sources) {
  const tsconfig = source.replace(/\/src$/, "/tsconfig*.json");
  if (!inputs.includes(tsconfig))
    errors.push(`turbo.json //#review:plugin inputs miss ${tsconfig}`);
}

const reviewTsconfig = join(host, "tsconfig.review.json");
const reviewIncludes = [
  ...readFileSync(reviewTsconfig, "utf8").matchAll(
    /^\s*"(\.\.\/\.\.\/packages\/[^"]+\/src)",?$/gm,
  ),
].map(([, path]) => relative(root, join(host, path!)));
compare(relative(root, reviewTsconfig), reviewIncludes);

if (errors.length > 0) {
  for (const error of errors) console.error(error);
  process.exit(1);
}
