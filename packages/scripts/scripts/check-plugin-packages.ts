#!/usr/bin/env node
// Holds the three plugin-package lists that a static file must spell out to
// what `pluginPackages` derives from each host's dependencies: the Tailwind
// `@source` lines of the host's stylesheet, the inputs of the host's review
// task in turbo.json, and the include list of the review program's tsconfig.
// The build, test and review configs read the derived list itself.
import type { PublishedPluginName } from "#shell/plugins";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { getWorkspaceRoot } from "#package-roots";
import { pluginPackages, reviewedPluginPackages } from "#plugin-packages";
import { PUBLISHED_PLUGINS } from "#shell/plugins";

/** The hosts that bundle plugin packages; a Resource Pack bundles none. */
type HostName = Exclude<PublishedPluginName, "resources">;

const HOSTS = {
  desktop: { stylesheet: "src/zt-main.css", reviewTask: "//#review:plugin" },
  reader: { stylesheet: "src/main.css", reviewTask: "//#review:reader" },
} as const satisfies Record<
  HostName,
  { stylesheet: string; reviewTask: string }
>;

const root = await getWorkspaceRoot(import.meta.dirname);
const turbo = JSON.parse(readFileSync(join(root, "turbo.json"), "utf8")) as {
  tasks: Record<string, { inputs?: string[] }>;
};
const errors: string[] = [];

for (const name of Object.keys(HOSTS) as HostName[]) {
  const host = join(root, PUBLISHED_PLUGINS[name].app);
  const { stylesheet, reviewTask } = HOSTS[name];
  const sourcesOf = (packages: readonly { root: string }[]) =>
    packages.map(({ root: dir }) => `${relative(root, dir)}/src`);
  const styled = sourcesOf(pluginPackages(host));
  const reviewed = sourcesOf(reviewedPluginPackages(host));

  const compare = (
    where: string,
    sources: readonly string[],
    listed: readonly string[],
  ) => {
    const missing = sources.filter((source) => !listed.includes(source));
    const extra = listed.filter((source) => !sources.includes(source));
    if (missing.length > 0)
      errors.push(`${where} misses ${missing.join(", ")}`);
    if (extra.length > 0)
      errors.push(
        `${where} names ${extra.join(", ")}, which the host does not bundle`,
      );
  };

  const stylesheetPath = join(host, stylesheet);
  const cssSources = [
    ...readFileSync(stylesheetPath, "utf8").matchAll(/^@source "([^"]+)";$/gm),
  ].map(([, path]) => relative(root, join(host, "src", path!)));
  compare(relative(root, stylesheetPath), styled, cssSources);

  const inputs = turbo.tasks[reviewTask]?.inputs ?? [];
  const reviewSources = inputs
    .filter(
      (input) => input.startsWith("packages/") && input.endsWith("/src/**"),
    )
    .map((input) => input.slice(0, -"/**".length));
  compare(`turbo.json ${reviewTask} inputs`, reviewed, reviewSources);
  for (const source of reviewed) {
    const tsconfig = source.replace(/\/src$/, "/tsconfig*.json");
    if (!inputs.includes(tsconfig))
      errors.push(`turbo.json ${reviewTask} inputs miss ${tsconfig}`);
  }

  const reviewTsconfig = join(host, "tsconfig.review.json");
  const reviewIncludes = [
    ...readFileSync(reviewTsconfig, "utf8").matchAll(
      /^\s*"(\.\.\/\.\.\/packages\/[^"]+\/src)",?$/gm,
    ),
  ].map(([, path]) => relative(root, join(host, path!)));
  compare(relative(root, reviewTsconfig), reviewed, reviewIncludes);
}

if (errors.length > 0) {
  for (const error of errors) console.error(error);
  process.exit(1);
}
