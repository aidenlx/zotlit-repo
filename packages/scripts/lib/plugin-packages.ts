import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

export const PLUGIN_KERNEL = "@zotlit/plugin-kernel";

export interface PluginPackage {
  readonly name: string;
  readonly root: string;
}

interface Manifest {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly pluginSources?: readonly string[];
}

function readManifest(root: string): Manifest {
  return JSON.parse(
    readFileSync(join(root, "package.json"), "utf8"),
  ) as Manifest;
}

function workspaceDependencies(manifest: Manifest): string[] {
  return Object.entries(manifest.dependencies ?? {})
    .filter(([, version]) => version.startsWith("workspace:"))
    .map(([name]) => name);
}

function workspaceGraph(
  hostRoot: string,
): Map<string, { root: string; dependencies: string[] }> {
  const packages = new Map<string, { root: string; dependencies: string[] }>();
  const visit = (name: string, fromRoot: string) => {
    if (packages.has(name)) return;
    const resolve = createRequire(join(fromRoot, "package.json")).resolve;
    const root = dirname(realpathSync(resolve(`${name}/package.json`)));
    const dependencies = workspaceDependencies(readManifest(root));
    packages.set(name, { root, dependencies });
    for (const dependency of dependencies) visit(dependency, root);
  };
  for (const name of workspaceDependencies(readManifest(hostRoot)))
    visit(name, hostRoot);
  return packages;
}

export function pluginPackages(hostRoot: string): PluginPackage[] {
  const packages = workspaceGraph(hostRoot);
  const reaches = new Map<string, boolean>();
  const buildsOnKernel = (name: string): boolean => {
    const known = reaches.get(name);
    if (known !== undefined) return known;
    reaches.set(name, false);
    const answer =
      name === PLUGIN_KERNEL ||
      (packages.get(name)?.dependencies ?? []).some(buildsOnKernel);
    reaches.set(name, answer);
    return answer;
  };
  return [...packages]
    .filter(([name]) => buildsOnKernel(name))
    .map(([name, { root }]) => ({ name, root }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function reviewedPluginPackages(hostRoot: string): PluginPackage[] {
  const packages = workspaceGraph(hostRoot);
  const named = (readManifest(hostRoot).pluginSources ?? []).map((name) => {
    const found = packages.get(name);
    if (!found) {
      throw new Error(
        `${hostRoot}/package.json names ${name} in pluginSources, which it does not depend on.`,
      );
    }
    return { name, root: found.root };
  });
  return [...pluginPackages(hostRoot), ...named].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}
