import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { SOURCE_REPOSITORY } from "@zotlit/config/repositories";

import { LEGAL_FILES } from "./legal-files.ts";
import type { PublishedPlugin } from "./plugins.ts";

interface AppPackage {
  readonly version: string;
  readonly description: string;
  readonly author: string;
  readonly obsidian: { readonly name: string };
}

export async function workspaceLicense(workspaceRoot: string): Promise<string> {
  const { license } = JSON.parse(
    await readFile(join(workspaceRoot, "package.json"), "utf8"),
  ) as { license: string };
  return license;
}

function shellEntrySource(plugin: PublishedPlugin): string {
  return `// Entry module of the plugin: re-exports the plugin class from the npm package that holds the plugin's code.
// Generated at each release from ${SOURCE_REPOSITORY}, where changes to the plugin go.
export { default } from "${plugin.bundlePackage}";
`;
}

const SHELL_TSCONFIG = {
  compilerOptions: {
    target: "ES2022",
    module: "ESNext",
    moduleResolution: "Bundler",
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    types: [],
  },
  include: ["src"],
};

export async function writeShellEntry(
  dir: string,
  plugin: PublishedPlugin,
): Promise<string> {
  const entry = join(dir, "src/main.ts");
  await mkdir(dirname(entry), { recursive: true });
  await writeFile(entry, shellEntrySource(plugin));
  await writeFile(
    join(dir, "tsconfig.json"),
    `${JSON.stringify(SHELL_TSCONFIG, null, 2)}\n`,
  );
  return entry;
}

const BUNDLE_TYPES = `// The plugin class Obsidian loads, a subclass of Plugin from "obsidian".
declare const plugin: abstract new (...args: never[]) => object;
export default plugin;
`;

function bundleReadme(plugin: PublishedPlugin, app: AppPackage): string {
  const { name } = app.obsidian;
  const version = app.version;
  return `# ${plugin.bundlePackage}

The bundle of the ${name} Obsidian plugin, version ${version}, for its publish
repository, [${plugin.repository}](https://github.com/${plugin.repository}).

${plugin.profile.bundleContents({ name, version, app: plugin.app })}`;
}

function bundleManifest(
  plugin: PublishedPlugin,
  app: AppPackage,
  license: string,
) {
  return {
    name: plugin.bundlePackage,
    version: app.version,
    description: `The bundle of the ${app.obsidian.name} Obsidian plugin that its publish repository builds from. ${app.description}`,
    author: app.author,
    license,
    homepage: `https://github.com/${plugin.repository}`,
    repository: {
      type: "git",
      url: `https://github.com/${SOURCE_REPOSITORY}`,
      directory: plugin.app,
    },
    ...plugin.profile.bundlePackage,
  };
}

export async function writeBundlePackage(options: {
  plugin: PublishedPlugin;
  app: AppPackage;
  dir: string;
  workspaceRoot: string;
}): Promise<void> {
  const { plugin, app, dir, workspaceRoot } = options;
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "package.json"),
    `${JSON.stringify(bundleManifest(plugin, app, await workspaceLicense(workspaceRoot)), null, 2)}\n`,
  );
  if (plugin.profile.entryModule) {
    await writeFile(join(dir, "main.d.ts"), BUNDLE_TYPES);
  }
  await writeFile(join(dir, "README.md"), bundleReadme(plugin, app));
  for (const file of LEGAL_FILES) {
    await copyFile(join(workspaceRoot, file), join(dir, file));
  }
}
