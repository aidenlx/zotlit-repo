// The bundle package of a published plugin: what a host app's production
// build writes beside the plugin's ES module, and the entry module that turns
// the package into the `main.js` Obsidian loads. The host app's build and the
// publish repository's build both read the entry from here, so they bundle the
// same module.
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { SOURCE_REPOSITORY } from "@zotlit/config/repositories";

import { LEGAL_FILES } from "./legal-files.ts";
import type { PublishedPlugin } from "./plugins.ts";

/** The fields of a host app's package.json the bundle package reads. */
interface AppPackage {
  readonly version: string;
  readonly description: string;
  readonly author: string;
  readonly obsidian: { readonly name: string };
}

/** The license of the workspace, from its root package.json. */
export async function workspaceLicense(workspaceRoot: string): Promise<string> {
  const { license } = JSON.parse(
    await readFile(join(workspaceRoot, "package.json"), "utf8"),
  ) as { license: string };
  return license;
}

/** `src/main.ts` of the publish repository: the plugin class, from the bundle package. */
function shellEntrySource(plugin: PublishedPlugin): string {
  return `// Entry module of the plugin: re-exports the plugin class from the npm package that holds the plugin's code.
// Generated at each release from ${SOURCE_REPOSITORY}, where changes to the plugin go.
export { default } from "${plugin.bundlePackage}";
`;
}

/** `tsconfig.json` of the publish repository, which type-checks `src/main.ts`. */
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

/**
 * Writes the publish repository's entry module, `src/main.ts`, and the
 * `tsconfig.json` its transform reads, into `dir`.
 *
 * @returns the path of `src/main.ts`.
 */
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

/** The type of the bundle's default export, for `src/main.ts`. */
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
    // npm provenance checks this against the repository that publishes.
    repository: {
      type: "git",
      url: `https://github.com/${SOURCE_REPOSITORY}`,
      directory: plugin.app,
    },
    ...plugin.profile.bundlePackage,
  };
}

/**
 * Writes the bundle package's own files into `dir`, beside the `main.js` and
 * `styles.css` the host app's build wrote there. A Resource Pack's bundle
 * package holds `main.js` alone.
 */
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
